import './env';

import { db } from './client';
import {
  actionContexts,
  actions,
  areasOfFocus,
  contexts,
  goals,
  lists,
  listItems,
  projects,
} from './schema';

/**
 * Idempotent-ish starter data: enough to exercise every view (Now, Waiting,
 * stalled projects, standby, an empty area) without pretending to be real.
 * Safe to re-run — it only inserts if the contexts table is empty.
 */
async function seed() {
  const existing = await db.select({ id: contexts.id }).from(contexts).limit(1);
  if (existing.length > 0) {
    console.log('Database already seeded — nothing to do.');
    return;
  }

  const ctx = await db
    .insert(contexts)
    .values([
      { name: 'Home', dimension: 'place' },
      { name: 'Office', dimension: 'place' },
      { name: 'Site', dimension: 'place' },
      { name: 'Errands', dimension: 'place' },
      { name: 'Computer', dimension: 'place' },
      { name: '5 min', dimension: 'time' },
      { name: '30 min', dimension: 'time' },
      { name: '2 hours', dimension: 'time' },
      { name: 'High', dimension: 'energy' },
      { name: 'Medium', dimension: 'energy' },
      { name: 'Low', dimension: 'energy' },
    ])
    .returning();

  const byName = (n: string) => ctx.find((c) => c.name === n)!.id;

  const [home, work, health] = await db
    .insert(areasOfFocus)
    .values([{ name: 'Home & Family' }, { name: 'Work' }, { name: 'Health' }])
    .returning();

  const [goal] = await db
    .insert(goals)
    .values([
      { areaId: home.id, title: 'Finish the flat renovation', targetDate: '2026-12-31' },
    ])
    .returning();

  const [kitchen, website, stalled, standby] = await db
    .insert(projects)
    .values([
      {
        title: 'Renovate the kitchen',
        areaId: home.id,
        goalId: goal.id,
        status: 'active',
      },
      { title: 'Rebuild personal website', areaId: work.id, status: 'active' },
      {
        // Deliberately has no next action — should show as stalled.
        title: 'Sort out the garage',
        areaId: home.id,
        status: 'active',
      },
      {
        title: 'Buy a road bike',
        areaId: health.id,
        status: 'standby',
        standbyReason: 'Awaiting the bonus in October',
      },
    ])
    .returning();

  const twentyDaysAgo = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);

  const inserted = await db
    .insert(actions)
    .values([
      { projectId: kitchen.id, title: 'Measure the wall for the units', status: 'next' },
      { projectId: kitchen.id, title: 'Call the plumber back', status: 'next' },
      {
        projectId: kitchen.id,
        title: 'Quote from the tiler',
        status: 'waiting',
        waitingSince: twentyDaysAgo,
      },
      { projectId: website.id, title: 'Pick a domain', status: 'next' },
      { projectId: website.id, title: 'Draft the about page', status: 'next' },
      { title: 'Renew passport', status: 'next' },
    ])
    .returning();

  const link = (title: string, names: string[]) => {
    const a = inserted.find((x) => x.title === title)!;
    return names.map((n) => ({ actionId: a.id, contextId: byName(n) }));
  };

  await db.insert(actionContexts).values([
    ...link('Measure the wall for the units', ['Home', '30 min', 'Low']),
    ...link('Call the plumber back', ['Home', '5 min', 'Low']),
    ...link('Pick a domain', ['Computer', '30 min', 'Medium']),
    ...link('Draft the about page', ['Computer', '2 hours', 'High']),
    ...link('Renew passport', ['Errands', '2 hours', 'Medium']),
  ]);

  const [somedayList, purchases] = await db
    .insert(lists)
    .values([
      { name: 'Someday / Maybe', type: 'someday_maybe' },
      { name: 'Purchases', type: 'purchases' },
    ])
    .returning();

  await db.insert(listItems).values([
    { listId: somedayList.id, title: 'Learn to sail' },
    { listId: somedayList.id, title: 'Walk the Camino' },
    {
      listId: purchases.id,
      title: 'Mitre saw',
      projectId: kitchen.id,
      fields: { cost: 180, impact: 'blocks', where: 'in_town' },
    },
    {
      listId: purchases.id,
      title: 'Second monitor',
      fields: { cost: 220, impact: 'improves', where: 'online' },
    },
  ]);

  console.log('Seeded: 3 areas, 1 goal, 4 projects, 6 actions, 11 contexts, 2 lists.');
  console.log(`Stalled project to look for: "${stalled.title}"`);
  console.log(`Standby project to look for: "${standby.title}"`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
