/**
 * Folders inside a box, against the real database and the real Drive.
 *
 * A folder is the one feature here whose whole promise is that two systems
 * agree: the app says a document is in a drawer, and opening Drive shows it in
 * that drawer. Nothing about that can be checked without asking Google, and
 * every way it goes wrong is silent — a file left behind in the box root looks
 * exactly like a file that was never moved, and the app goes on saying the
 * opposite with complete confidence.
 *
 * So this is a live test. It makes a throwaway box, does to it every
 * rearrangement the app can do, reads the answer back *out of Drive* each time
 * rather than trusting the call that has just been made, and then takes itself
 * away again — rows deleted, Drive folders binned.
 *
 *   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
 *        scripts/check-box-folders.mjs
 *
 * It costs no model calls and touches no box you own. It does need Drive
 * connected, because Drive is the thing being asked.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(join(root, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, '');
}

const { boxFolders, boxItems, boxes, db } = await import('@gtd/db');
const { eq, sql } = await import('drizzle-orm');

const {
  boxItemDestination,
  createBoxDocument,
  deleteBoxItem,
  ensureBoxFolder,
  ensureBoxSubfolder,
  moveBoxItemFile,
  pushFolderName,
  reconcileBoxFiles,
  reconcileBoxFolders,
  trashFolderIfEmpty,
} = await import('../apps/web/src/lib/google/boxes.ts');

const { ensureFolder, folderChildIds, getFile, moveFile, renameFolder, trashFile } =
  await import('../apps/web/src/lib/google/client.ts');

const { getBoxFolders, getBoxItem, getBoxItems } = await import(
  '../apps/web/src/lib/queries.ts'
);

let failed = 0;
const tidy = [];

function ok(label, condition, detail) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed += 1;
}

/** Where Drive says a file is. Read back every time; never inferred. */
async function parentOf(driveId) {
  const file = await getFile(driveId);
  return file?.parents?.[0] ?? null;
}

const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const BOX_NAME = `zz folder check ${stamp}`;

console.log(`\n# A throwaway box called "${BOX_NAME}"\n`);

const [box] = await db
  .insert(boxes)
  .values({ name: BOX_NAME, isDefault: false })
  .returning({ id: boxes.id });

const [other] = await db
  .insert(boxes)
  .values({ name: `${BOX_NAME} b`, isDefault: false })
  .returning({ id: boxes.id });

try {
  // -------------------------------------------------------------------------
  // The drawers themselves
  // -------------------------------------------------------------------------

  ok('a box with no folders reports none', (await getBoxFolders(box.id)).length === 0);

  const [one] = await db
    .insert(boxFolders)
    .values({ boxId: box.id, name: 'Receipts' })
    .returning({ id: boxFolders.id });

  const [two] = await db
    .insert(boxFolders)
    .values({ boxId: box.id, name: 'Letters' })
    .returning({ id: boxFolders.id });

  ok('two folders, with no Drive folder yet', (await getBoxFolders(box.id)).length === 2);

  /* The index is the guarantee, not the action's own check: two drawers with
     one name would be one drawer in Drive. */
  let refused = false;
  try {
    await db.insert(boxFolders).values({ boxId: box.id, name: 'rECEIPTS' });
  } catch {
    refused = true;
  }
  ok('the same name in another case is refused by the database', refused);

  /* …and the same name in a *different* box is fine, because a folder belongs
     to one box and nothing is shared between them. */
  const [elsewhere] = await db
    .insert(boxFolders)
    .values({ boxId: other.id, name: 'Receipts' })
    .returning({ id: boxFolders.id });

  ok('the same name in another box is allowed', Boolean(elsewhere?.id));

  // -------------------------------------------------------------------------
  // Drive: a drawer is a real subfolder of the box's own folder
  // -------------------------------------------------------------------------

  const boxDrive = await ensureBoxFolder(box.id);
  tidy.push(boxDrive);
  const oneDrive = await ensureBoxSubfolder(one.id);

  ok('the drawer is a child of the box folder', (await parentOf(oneDrive)) === boxDrive);
  ok(
    'and it is named after the folder',
    (await getFile(oneDrive))?.name === 'Receipts',
    (await getFile(oneDrive))?.name,
  );

  const [storedOne] = await db
    .select({ driveFolderId: boxFolders.driveFolderId })
    .from(boxFolders)
    .where(eq(boxFolders.id, one.id));

  ok('the id is written down', storedOne.driveFolderId === oneDrive);
  ok('asking twice makes one folder', (await ensureBoxSubfolder(one.id)) === oneDrive);

  ok(
    'the box itself is the destination for a loose entry',
    (await boxItemDestination(box.id, null)) === boxDrive,
  );
  ok(
    'and the drawer for one in a drawer',
    (await boxItemDestination(box.id, one.id)) === oneDrive,
  );

  // -------------------------------------------------------------------------
  // A document made straight into a drawer
  // -------------------------------------------------------------------------

  const made = await createBoxDocument(box.id, 'text/markdown', 'Filed note', one.id);

  const [madeRow] = await db
    .select({ folderId: boxItems.folderId, driveFileId: boxItems.driveFileId })
    .from(boxItems)
    .where(eq(boxItems.id, made.id));

  ok('a new document remembers its drawer', madeRow.folderId === one.id);
  ok(
    'and its file was created inside it, not moved there afterwards',
    (await parentOf(madeRow.driveFileId)) === oneDrive,
  );

  const detail = await getBoxItem(made.id);
  ok('the detail pane is told which drawer it is in', detail?.folderId === one.id);
  ok('and what it is called', detail?.folderName === 'Receipts', detail?.folderName);

  // -------------------------------------------------------------------------
  // Moving between drawers, and out again
  // -------------------------------------------------------------------------

  await db.update(boxItems).set({ folderId: two.id }).where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);

  const twoDrive = (
    await db
      .select({ d: boxFolders.driveFolderId })
      .from(boxFolders)
      .where(eq(boxFolders.id, two.id))
  )[0].d;

  ok('moving to another drawer makes that drawer in Drive', Boolean(twoDrive));
  ok('and the file is inside it', (await parentOf(madeRow.driveFileId)) === twoDrive);
  ok(
    'the first drawer no longer holds it',
    !(await folderChildIds(oneDrive)).has(madeRow.driveFileId),
  );

  await db.update(boxItems).set({ folderId: null }).where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);
  ok(
    'taking it out puts the file back in the box',
    (await parentOf(madeRow.driveFileId)) === boxDrive,
  );

  await db.update(boxItems).set({ folderId: one.id }).where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);
  ok(
    'and putting it in one works from the box as well',
    (await parentOf(madeRow.driveFileId)) === oneDrive,
  );

  // -------------------------------------------------------------------------
  // Renaming a drawer
  // -------------------------------------------------------------------------

  await db.update(boxFolders).set({ name: 'Bills' }).where(eq(boxFolders.id, one.id));
  ok('a rename is pushed to Drive', await pushFolderName(one.id));
  ok('and Drive agrees', (await getFile(oneDrive))?.name === 'Bills');
  ok(
    'the documents inside did not move',
    (await folderChildIds(oneDrive)).has(madeRow.driveFileId),
  );
  ok('pushing the same name again is not a second write', !(await pushFolderName(one.id)));

  // -------------------------------------------------------------------------
  // The sweeps: drift put right with nobody pressing anything
  // -------------------------------------------------------------------------

  /* A file dragged out of its drawer in Drive. */
  await moveFile(madeRow.driveFileId, boxDrive);
  ok('the drift is real before the sweep', (await parentOf(madeRow.driveFileId)) === boxDrive);
  await reconcileBoxFiles(50);
  ok(
    'the file sweep puts it back in its drawer',
    (await parentOf(madeRow.driveFileId)) === oneDrive,
  );

  /* A drawer renamed in Drive by hand. */
  await renameFolder(oneDrive, 'Renamed by hand');
  await reconcileBoxFolders(50);
  ok('the folder sweep restores the name', (await getFile(oneDrive))?.name === 'Bills');

  /* A drawer dragged out of its box in Drive. */
  const strayParent = await ensureFolder(`zz stray check ${stamp}`, null);
  tidy.push(strayParent);
  await moveFile(oneDrive, strayParent);
  ok('a drawer really can be dragged away', (await parentOf(oneDrive)) === strayParent);
  await reconcileBoxFolders(50);
  ok('the folder sweep puts it back under its box', (await parentOf(oneDrive)) === boxDrive);

  /* A drawer whose Drive folder never existed, holding a document. */
  await db.update(boxFolders).set({ driveFolderId: null }).where(eq(boxFolders.id, two.id));
  await db.update(boxItems).set({ folderId: two.id }).where(eq(boxItems.id, made.id));
  await reconcileBoxFiles(50);

  const [twoAgain] = await db
    .select({ d: boxFolders.driveFolderId })
    .from(boxFolders)
    .where(eq(boxFolders.id, two.id));

  ok('the file sweep makes a drawer that has none', Boolean(twoAgain.d));
  ok('and files the document into it', (await parentOf(madeRow.driveFileId)) === twoAgain.d);

  /* A drawer trashed in Drive: the id is cleared, never recreated on the spot. */
  const [spare] = await db
    .insert(boxFolders)
    .values({ boxId: box.id, name: 'Spare' })
    .returning({ id: boxFolders.id });

  const spareDrive = await ensureBoxSubfolder(spare.id);
  await trashFile(spareDrive);
  await reconcileBoxFolders(50);

  const [spareAfter] = await db
    .select({ d: boxFolders.driveFolderId })
    .from(boxFolders)
    .where(eq(boxFolders.id, spare.id));

  ok('a drawer trashed in Drive has its id forgotten', spareAfter.d === null);

  // -------------------------------------------------------------------------
  // Binning a drawer, and only once it is empty
  // -------------------------------------------------------------------------

  const holding = twoAgain.d;
  ok('a drawer holding a document is not binned', !(await trashFolderIfEmpty(holding)));
  ok('and is still there', (await getFile(holding))?.trashed === false);

  await db.update(boxItems).set({ folderId: null }).where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);
  ok('an empty drawer is binned', await trashFolderIfEmpty(holding));
  ok('and Drive says so', (await getFile(holding))?.trashed === true);
  ok(
    'the document it held is safe in the box',
    (await parentOf(madeRow.driveFileId)) === boxDrive,
  );

  // -------------------------------------------------------------------------
  // Moving an entry to another box takes it out of its drawer
  // -------------------------------------------------------------------------

  await db.update(boxItems).set({ folderId: one.id }).where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);

  /* What `moveDocument` writes: a new box and no folder — the drawer belonged
     to the box it has just left. */
  await db
    .update(boxItems)
    .set({ boxId: other.id, folderId: null })
    .where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);

  const otherDrive = await ensureBoxFolder(other.id);
  tidy.push(otherDrive);
  ok(
    'a moved entry lands in the new box, not in a drawer of the old one',
    (await parentOf(madeRow.driveFileId)) === otherDrive,
  );

  await db
    .update(boxItems)
    .set({ boxId: box.id, folderId: one.id })
    .where(eq(boxItems.id, made.id));
  await moveBoxItemFile(made.id);

  // -------------------------------------------------------------------------
  // What the lists show
  // -------------------------------------------------------------------------

  await db.insert(boxItems).values({
    boxId: box.id,
    kind: 'note',
    description: 'a loose note',
    searchText: 'a loose note',
    status: 'ready',
    capturedAt: new Date(),
  });

  const all = await getBoxItems(box.id, [], {});
  ok('with no drawer open the box shows everything', all.length === 2, `${all.length}`);

  const inOne = await getBoxItems(box.id, [], {}, one.id);
  ok('a drawer shows only what is in it', inOne.length === 1 && inOne[0].id === made.id);

  const counts = await getBoxFolders(box.id);
  ok(
    'the drawer counts what it holds',
    counts.find((f) => f.id === one.id)?.count === 1,
    `${counts.find((f) => f.id === one.id)?.count}`,
  );
  ok(
    'and an empty drawer counts nothing',
    counts.find((f) => f.id === two.id)?.count === 0,
  );

  /* A drawer combines with the other filters rather than replacing them. */
  ok(
    'a date range still narrows inside a drawer',
    (await getBoxItems(box.id, [], { from: '2999-01-01', to: '2999-12-31' }, one.id))
      .length === 0,
  );

  const today = new Date().toISOString().slice(0, 10);
  ok(
    "and today's range keeps it",
    (await getBoxItems(box.id, [], { from: today, to: today }, one.id)).length === 1,
  );

  /* An unlisted entry is out of the feed, and out of the count with it. */
  await db.update(boxItems).set({ listed: false }).where(eq(boxItems.id, made.id));
  ok(
    'an unlisted entry leaves the drawer count',
    (await getBoxFolders(box.id)).find((f) => f.id === one.id)?.count === 0,
  );
  ok('and the drawer listing', (await getBoxItems(box.id, [], {}, one.id)).length === 0);
  await db.update(boxItems).set({ listed: true }).where(eq(boxItems.id, made.id));

  // -------------------------------------------------------------------------
  // Deleting the folder row frees its documents, and never deletes them
  // -------------------------------------------------------------------------

  await db.delete(boxFolders).where(eq(boxFolders.id, one.id));

  const [freed] = await db
    .select({ folderId: boxItems.folderId })
    .from(boxItems)
    .where(eq(boxItems.id, made.id));

  ok('deleting a drawer sets its documents loose', freed && freed.folderId === null);

  await moveBoxItemFile(made.id);
  ok(
    'and their files come back to the box',
    (await parentOf(madeRow.driveFileId)) === boxDrive,
  );

  // -------------------------------------------------------------------------
  // Deleting the box takes its folder rows with it
  // -------------------------------------------------------------------------

  const before = await db
    .select({ id: boxFolders.id })
    .from(boxFolders)
    .where(eq(boxFolders.boxId, box.id));

  ok('the box still has folders to lose', before.length > 0);

  await deleteBoxItem(made.id).catch(() => {});
  await db.delete(boxItems).where(eq(boxItems.boxId, box.id));
  await db.delete(boxes).where(eq(boxes.id, box.id));

  const after = await db
    .select({ id: boxFolders.id })
    .from(boxFolders)
    .where(eq(boxFolders.boxId, box.id));

  ok('deleting the box cascades its folders away', after.length === 0);
} finally {
  /* The rows go whatever happened: a failed run must not leave a test box in
     the sidebar. Drive folders are trashed, never deleted, like everything
     else this app removes. */
  await db.delete(boxItems).where(sql`${boxItems.boxId} in (select id from boxes where name like 'zz folder check %')`);
  await db.delete(boxes).where(sql`${boxes.name} like ${'zz folder check %'}`);
  for (const id of tidy) await trashFile(id).catch(() => {});
}

console.log(
  failed === 0 ? '\nAll folder checks passed.\n' : `\n${failed} folder check(s) failed.\n`,
);

process.exit(failed === 0 ? 0 : 1);
