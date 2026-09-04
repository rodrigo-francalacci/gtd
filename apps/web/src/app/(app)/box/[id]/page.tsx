import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DayHeading } from '@/components/day-heading';
import { documentLabel } from '@/lib/queries.shared';
import { DayJournal } from '@/components/day-journal';
import { DocumentDetail } from '@/components/document-detail';
import { BoxComposer } from '@/components/box-composer';
import { BoxLayoutToggle } from '@/components/box-layout-toggle';
import { deleteDocument } from '@/lib/actions';
import { ListKeys } from '@/components/list-keys';
import { TagDrop } from '@/components/tag-drop';
import { TagPanelButton } from '@/components/tag-panel-button';
import { DateRange } from '@/components/date-range';
import { DocumentGalleryRow } from '@/components/document-gallery-row';
import { DocumentRow } from '@/components/document-row';
import { DocumentMenu } from '@/components/entry-menu';
import { FocusView } from '@/components/focus-view';
import { NoteEditor } from '@/components/note-editor';
import { updateBoxItemNotes } from '@/lib/actions';
import { docFromText } from '@/lib/tiptap';
import { EmailRequests } from '@/components/email-requests';
import { getEmailRequests } from '@/lib/box/email-requests';
import { ActionDetail } from '@/components/action-detail';
import { GoogleTree } from '@/components/google-tree';
import { ProjectDetail } from '@/components/project-detail';
import type { ResolvedLinks } from '@/components/note-text';
import { openHref, readToken, tokenFor, tokensIn } from '@/lib/internal-link';
import { TagBrowser } from '@/components/tag-browser';
import { TagFilter } from '@/components/tag-filter';
import { TypeFilter } from '@/components/type-filter';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { BOX_COLUMNS } from '@/lib/columns';
import { groupByDay } from '@/lib/days';
import { timelinesFor } from '@/lib/actions';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import {
  getActionQueue,
  getAreasAndGoals,
  getBox,
  getBoxCategories,
  getBoxDayNotes,
  getBoxItem,
  getBoxItems,
  getBoxRange,
  getBoxTagIds,
  getBoxes,
  getLinkableDocuments,
  getProject,
  getProjectActions,
  getAction,
  getAttachableActions,
  getContextsByDimension,
  getFolderTree,
  getLinkableEntries,
  getProjectOptions,
  getProjectTree,
  resolveInternalLinks,
} from '@/lib/queries';
import { ENTRY_TYPE_ORDER, entryTypeOf, type EntryType } from '@/lib/queries.shared';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

/**
 * One box, read from the top.
 *
 * Always grouped by day, in every density — unlike the inbox, where grouping
 * is the simple view's answer to having no timestamps. Here the arrival date
 * *is* the filing system, so it is the one thing that can't be a preference.
 */
export default async function BoxPage(props: PageProps<'/box/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const box = await getBox(id);
  if (!box) notFound();

  const raw = searchParams.tag;
  const requested = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const selectedId = typeof searchParams.doc === 'string' ? searchParams.doc : null;

  // A tag id from the URL that isn't in this box would silently return nothing
  // and look like an empty box rather than a bad filter.
  const known = await getBoxTagIds(id);
  const tagIds = requested.filter((t) => known.has(t));

  /**
   * Tags being filtered *against*: show everything that does *not* carry one.
   *
   * The other question a box asks constantly — "the fuel receipts that aren't
   * Shell" — which previously needed every other vendor selected by hand. That
   * is not the same query, and it stops being right the moment a new vendor
   * appears.
   *
   * A separate parameter rather than a `-` prefix on `tag`, because the values
   * are uuids and a prefix would make the parser responsible for telling a
   * sign apart from an id. Two lists cannot be misread.
   */
  const notRaw = searchParams.nottag;
  const excludedTags = (
    notRaw === undefined ? [] : Array.isArray(notRaw) ? notRaw : [notRaw]
  ).filter((t) => known.has(t) && !tagIds.includes(t));

  /**
   * A day from the URL, or nothing. An unparseable one is ignored rather than
   * refused: a filter you cannot see is better than a page that won't load.
   */
  const day = (value: unknown): Date | undefined => {
    if (typeof value !== 'string') return undefined;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const range = { from: day(searchParams.from), to: day(searchParams.to) };

  const viewKey = densityKeys.box(id);
  const [matched, categories, dayNotes, prefs, boxList, span, view, asked] =
    await Promise.all([
      getBoxItems(id, tagIds, range),
      getBoxCategories(id),
      getBoxDayNotes(),
      getPreferences(),
      getBoxes(),
      getBoxRange(id),
      getView(viewKey),
      getEmailRequests(id),
    ]);

  const viewMode = view.density ?? prefs.viewMode;
  // This box's own answer, or the default a box that has never been switched
  // follows — exactly how the density above resolves.
  const boxView = view.boxView ?? prefs.boxView;

  /*
   * Exclusions are applied in memory, where the positive tags were matched in
   * SQL — because the rows already carry their tags, so the answer is here and
   * a second query would only ask the database something it has just told us.
   *
   * NONE rather than NOT ALL: excluding Shell and Tesco means an entry
   * carrying either is out. Anything else would make adding a second exclusion
   * *widen* the result, which is the trap the positive tags avoid by being AND.
   */
  const items =
    excludedTags.length === 0
      ? matched
      : matched.filter((item) => !item.tags.some((t) => excludedTags.includes(t.id)));

  /**
   * The type filter is applied here rather than in SQL.
   *
   * `entryTypeOf` turns a kind and a mime type into one of a dozen words, and
   * expressing that twice — once in TypeScript, once as a pile of `like`
   * clauses — would be two definitions to keep in agreement, which is exactly
   * the trap `canClassify` and `READABLE` had to be warned about. A box holds
   * tens or hundreds of rows, so filtering them in memory costs nothing worth
   * the duplication.
   *
   * Types are OR-ed, unlike the tags: nothing is both audio and a place, so
   * requiring all of them would always return nothing.
   */
  const requestedTypes = (
    typeof searchParams.type === 'string'
      ? [searchParams.type]
      : Array.isArray(searchParams.type)
        ? searchParams.type
        : []
  ).filter((t): t is EntryType => (ENTRY_TYPE_ORDER as string[]).includes(t));

  const excludedTypes = (
    typeof searchParams.nottype === 'string'
      ? [searchParams.nottype]
      : Array.isArray(searchParams.nottype)
        ? searchParams.nottype
        : []
  )
    .filter((t): t is EntryType => (ENTRY_TYPE_ORDER as string[]).includes(t))
    // A type cannot be both wanted and unwanted; the positive one wins.
    .filter((t) => !requestedTypes.includes(t));

  const shown = items.filter((item) => {
    const type = entryTypeOf(item);
    // Included types are OR — nothing is both audio and a place. Excluded ones
    // are NONE, so adding a second exclusion narrows rather than widens.
    if (requestedTypes.length > 0 && !requestedTypes.includes(type)) return false;
    return !excludedTypes.includes(type);
  });

  /**
   * Counts for each facet are taken with the *other* filters applied but not
   * its own — otherwise picking Audio would leave Audio as the only type on
   * offer, and there would be no way to see what else was there.
   */
  const typeCounts: Record<string, number> = {};
  for (const item of items) {
    const type = entryTypeOf(item);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }

  const tagCounts: Record<string, number> = {};
  for (const item of shown) {
    for (const tag of item.tags) {
      tagCounts[tag.id] = (tagCounts[tag.id] ?? 0) + 1;
    }
  }

  /**
   * A chosen row wins over the filters, and that is a change.
   *
   * It used to fall back whenever the selection was not among the rows on
   * screen, which was right while the only reason for that was a filter you
   * had just changed. It stopped being right when an entry could be in a box
   * and deliberately not in its feed: arriving from a project, or from search,
   * the pane would quietly show you a different document.
   *
   * `getBoxItem` fetches by id and returns null for anything that is not there,
   * so an id naming nothing still shows an empty pane — it just does so on the
   * row not existing rather than on it not being listed.
   */
  const targetId = selectedId ?? shown[0]?.id ?? null;

  const [selected, projectOptions, linkableActions, linkableEntries] = await Promise.all([
    targetId ? getBoxItem(targetId) : Promise.resolve(null),
    getProjectOptions(),
    getAttachableActions(),
    getLinkableEntries(),
  ]);

  /**
   * What a note in this box can be pointed at, by name.
   *
   * Open work only, which is what both of those queries already answer - a
   * picker offering a year of finished steps is a picker nobody scrolls, and
   * the paste-an-id path is still there for the rare link to something closed.
   */
  const linkTargets = [
    ...projectOptions.map((p) => ({ kind: 'project' as const, id: p.id, title: p.title })),
    ...linkableActions.map((a) => ({ kind: 'action' as const, id: a.id, title: a.title })),
    /*
     * Entries from every box, newest first and capped — the case this exists
     * for is a note in one box pointing at something filed in another. The box
     * is in the label because two receipts from the same shop in two boxes are
     * otherwise the same line twice.
     */
    ...linkableEntries.map((e) => ({
      kind: 'boxItem' as const,
      id: e.id,
      title: `${e.title.replace(/\s+/g, ' ').slice(0, 70)} · ${e.boxName}`,
    })),
  ];

  /*
   * A milestone opens the project itself, in the pane a document would have
   * used.
   *
   * The row is a shortcut to the project and nothing more — there is no
   * "milestone" to inspect, because everything it says is read off the project
   * already. So selecting one shows exactly what clicking that project would
   * show, without leaving the timeline that got you there.
   *
   * Fetched only for an event, and only when one is selected: on every other
   * click these six queries do not happen at all.
   */
  const eventProjectId = selected?.kind === 'event' ? (selected.projectId ?? null) : null;

  /**
   * A project or an action asked for by a link in a note.
   *
   * Read from the URL rather than held in client state, for the same reason the
   * selected row is: it should survive a refresh, it should be shareable, and
   * the pane that renders it is a Server Component either way.
   *
   * A Drive folder never gets here. `openHref` leaves that one alone - the app
   * holds `drive.file` and cannot see inside a folder it did not create, so
   * there is nothing of it to draw and the honest place to send you is Drive.
   */
  const opened =
    typeof searchParams.open === 'string' ? readToken(searchParams.open) : null;

  const openProjectId = opened?.kind === 'project' ? opened.id : null;
  const openActionId = opened?.kind === 'action' ? opened.id : null;
  const openFolderId = opened?.kind === 'drive' ? opened.id : null;

  /*
   * An entry in *any* box, which is the point of the `B` token.
   *
   * It opens in this box's pane three even when it lives in another one — you
   * followed a line in this journal and want to see what it referred to, not to
   * be moved to a different feed and have to find your way back. The header
   * says which box it came from, so nothing is pretending it lives here.
   *
   * Guarded against pointing at the entry already selected: that would draw the
   * same pane twice over and offer a "back" to where you already are.
   */
  const openEntryId =
    opened?.kind === 'boxItem' && opened.id !== targetId ? opened.id : null;

  /*
   * The same six queries the milestone branch runs, for the same pane.
   *
   * Selecting a milestone already opens a project in pane three, so a link
   * doing it is not a new shape - it is the existing one reached another way,
   * which is why this shares the fetch rather than growing a second copy of it.
   */
  /*
   * A link wins over the milestone.
   *
   * Both can be true at once - a milestone row selected and a note's link
   * followed - and the link is the thing just clicked, so it is the thing being
   * asked for. The milestone is where you were.
   */
  const paneProjectId = openProjectId ?? eventProjectId;

  /*
   * A linked Drive folder, as an Apps Script last found it.
   *
   * Never fetched from Google here - the app holds `drive.file` and cannot see
   * inside a folder it did not create, which is the whole reason the script
   * exists. What is shown is a snapshot with its date on it, and every row in
   * it opens in Drive, which is the copy that cannot be stale.
   */
  const openFolder = openFolderId ? await getFolderTree(openFolderId) : null;

  const openEntry = openEntryId ? await getBoxItem(openEntryId) : null;

  /*
   * The *target's* vocabulary, not this box's.
   *
   * The pane offers to take tags off and to add them, and a box's tags are its
   * own rows — handing it the categories of the box you happen to be reading
   * would offer to tag a Work document with the Feed's words, which is a
   * mistake you would not notice until the facet counts stopped adding up.
   */
  const entryCategories = openEntry ? await getBoxCategories(openEntry.boxId) : []; 

  const openAction = openActionId ? await getAction(openActionId) : null;

  /* What the selected step becomes when it is ticked off. */
  const actionQueue = openAction ? await getActionQueue(openAction.id) : undefined;

  const actionPane =
    openAction
      ? await Promise.all([
          attachmentsFor('action', openAction.id),
          documentsFor('action', openAction.id),
          getLinkableDocuments('action', openAction.id, ''),
          getContextsByDimension(),
        ])
      : null;

  const timeline = paneProjectId
    ? await Promise.all([
        getProject(paneProjectId),
        getProjectActions(paneProjectId),
        getAreasAndGoals(),
        attachmentsFor('project', paneProjectId),
        documentsFor('project', paneProjectId),
        getLinkableDocuments('project', paneProjectId, ''),
        getBoxes(),
        timelinesFor(paneProjectId),
        /*
         * The Drive and Gmail listing, which this pane was missing.
         *
         * Selecting a milestone opens the project in the pane a document would
         * have used — and it was the same component with one prop short, so the
         * project you reached from a timeline had no way to browse its files
         * while the same project reached from the list did. A shortcut that
         * arrives somewhere less capable than the long way round is a shortcut
         * you stop trusting.
         */
        getProjectTree(paneProjectId),
      ])
    : null;

  /*
   * Split once, walked once, drawn once.
   *
   * `ListKeys` is handed the order the eye sees, and the arrows have already
   * been wrong here twice by being given the fetched order while the page drew
   * a grouped one. Pinning adds a third grouping, so the order is computed here
   * and the same value feeds both.
   */
  const pinned = shown.filter((item) => item.pinned);
  const unpinned = shown.filter((item) => !item.pinned);
  const walked = [
    ...pinned,
    ...groupByDay(unpinned, (i) => i.capturedAt).flatMap((day) => day.items),
  ];

  const href = (docId: string) => {
    const params = new URLSearchParams();
    tagIds.forEach((t) => params.append('tag', t));
    excludedTags.forEach((t) => params.append('nottag', t));
    // The filters have to survive selecting a row, or clicking a result would
    // throw away the search that found it.
    requestedTypes.forEach((t) => params.append('type', t));
    excludedTypes.forEach((t) => params.append('nottype', t));
    if (typeof searchParams.from === 'string') params.set('from', searchParams.from);
    if (typeof searchParams.to === 'string') params.set('to', searchParams.to);
    params.set('doc', docId);
    return `/box/${id}?${params}`;
  };

  /**
   * The same row, with the window given over to it.
   *
   * Built from `href` rather than beside it, so every filter the feed is under
   * survives being opened and closed again — the same reason the board's
   * addresses are one builder.
   */
  const focusHref = (docId: string) => `${href(docId)}&focus=1`;

  /**
   * A link inside a note, followed without leaving the box.
   *
   * That is the whole point of linking from a journal: you are reading down a
   * feed and want to see what a line refers to, not to be moved to another
   * page and have to find your way back. So the address is this box's own, with
   * `open` set - the filters, the day you had scrolled to and the entry you had
   * selected all stay exactly where they were.
   */
  const openBase = href(targetId ?? '');

  const openInPane = (token: string) => {
    const target = readToken(token);
    return target ? openHref(openBase, target) : '#';
  };

  /*
   * One lookup for every link in the feed.
   *
   * Resolved rather than stored, which is what makes a rename a non-event: the
   * mark holds an id and nothing else, so a project renamed this morning is
   * still pointed at correctly by a note written last year. The cost is this,
   * and it is two statements however many links there are - and none at all in
   * a box whose notes contain no links, which is nearly all of them.
   */
  const tokens = shown.flatMap((item) => tokensIn(item.notes));
  const resolved = await resolveInternalLinks(tokens);

  const links: ResolvedLinks = new Map();
  for (const target of tokens) {
    const token = tokenFor(target);
    const known = resolved.get(token);
    links.set(
      token,
      known ? { title: known.title, href: openInPane(token) } : null,
    );
  }



  /**
   * One entry, opened to work on: what you wrote on the left, everything the
   * entry *is* on the right.
   *
   * Rendered instead of the panes rather than over them, for the reason the
   * boards are: it covers the window either way, and drawing both would mount
   * this note's editor twice — two autosaves for one document.
   *
   * Only for a real entry. A milestone opens the project and has no note of its
   * own, and there is nothing to focus on a pane that is already showing
   * somebody else's row.
   */
  if (searchParams.focus !== undefined && selected && !opened && selected.kind !== 'event') {
    return (
      <FocusView
        title={documentLabel(selected)}
        subtitle={box.name}
        closeHref={href(selected.id)}
        notes={
          <NoteEditor
            key={selected.id}
            surface="box_item"
            id={selected.id}
            targets={linkTargets}
            openBase={openBase}
            height={selected.noteHeight ?? null}
            dense={selected.noteDense ?? null}
            initialContent={selected.notes ?? docFromText(selected.description ?? '')}
            onSave={updateBoxItemNotes.bind(null, selected.id)}
            placeholder="Write something."
            fill
          />
        }
        rest={
          <DocumentDetail
            key={selected.id}
            item={selected}
            categories={categories}
            boxes={boxList}
            projects={projectOptions}
            linkTargets={linkTargets}
            openBase={openBase}
            hideNotes
          />
        }
      />
    );
  }

  return (
    <>
      <ListPane
        title={box.name}
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth(prefs)}
        columns={boxView === 'gallery' ? undefined : BOX_COLUMNS}
        /*
         * Only what is about the *view* stays here. Reading the queue and
         * editing the vocabulary are things you do to the box, and they live on
         * the box's own entry in the sidebar — right-click, or press and hold.
         * They were taking permanent width from the one pane header that
         * already had the most in it.
         */
        /*
         * One control for how the box is looked at, and the tag button beside
         * it. The density switch `ListPane` renders for every other list is
         * turned off here — a box's three answers are pictures, columns and
         * titles, and `comfortable` is not one of them.
         */
        showToggle={false}
        actions={
          <>
            <TagPanelButton total={categories.reduce((n, c) => n + c.tags.length, 0)} />
            <BoxLayoutToggle view={boxView} mode={viewMode} viewKey={viewKey} />
          </>
        }
        subtitle={
          <div className="flex flex-col gap-2">
            {span ? (
              /* key: the handles are local state so they can follow the
                 cursor, and this is how they re-seed when the URL changes for
                 another reason — a remount rather than an effect syncing two
                 sources of truth. */
              <DateRange
                key={`${searchParams.from ?? ''}|${searchParams.to ?? ''}`}
                boxId={id}
                earliest={span.from}
                latest={span.to}
                from={typeof searchParams.from === 'string' ? searchParams.from : undefined}
                to={typeof searchParams.to === 'string' ? searchParams.to : undefined}
              />
            ) : null}
            <TypeFilter
              boxId={id}
              counts={typeCounts}
              selected={requestedTypes}
              excluded={excludedTypes}
            />
            <TagFilter
              boxId={id}
              categories={categories}
              selected={tagIds}
              excluded={excludedTags}
              counts={tagCounts}
            />
            {/*
              Renders nothing here. It portals into the sidebar when opened,
              because the thing that knows what the tags are is this page and
              the column it wants is four route segments above it.
            */}
            <TagBrowser
              boxId={id}
              boxName={box.name}
              categories={categories}
              selected={tagIds}
              excluded={excludedTags}
              counts={tagCounts}
              showing={shown.length}
            />
          </div>
        }
      >
        {/*
          Walked in the order the feed is drawn, days and all — flattened from
          the same grouping the rows come out of, so the arrows and the list
          cannot disagree. That matters here more than anywhere: editing an
          entry's arrival date *moves it*, and the selection stays with the
          entry rather than the position because it lives in the URL.
        */}
        <ListKeys
          rows={walked.map((item) => ({ id: item.id, href: href(item.id) }))}
          selectedId={targetId}
          onDelete={deleteDocument}
          deleteLabel="Throw it away"
          deleteNote="The file goes to Drive’s bin."
        />

        <BoxComposer boxId={id} />
        <EmailRequests requests={asked} />

        {shown.length === 0 ? (
          <EmptyList
            message={
              tagIds.length > 0 || requestedTypes.length > 0 || range.from || range.to
                ? 'Nothing here matches that. Widen the dates, or drop a tag.'
                : box.itemCount === 0
                  ? 'Nothing here yet. Write something above, drop a file in, or scan into the folder this box watches.'
                  : 'Nothing to show.'
            }
          />
        ) : (
          <>
          {/*
            Pinned entries, above the timeline rather than inside it.
            
            A box is ordered and grouped by arrival, and that is the filing
            system — so lifting a pinned entry out is honest where sliding it up
            the middle of the days would make every heading slightly untrue.
            Within the block, arrival still decides, which is what a box does
            everywhere else.
          */}
          {pinned.length > 0 ? (
            <section>
              <DayHeading label={pinned.length === 1 ? 'Pinned' : `Pinned · ${pinned.length}`} />
              {pinned.map((item) => (
                <TagDrop key={item.id} itemId={item.id} label={documentLabel(item)} accepts={item.kind !== 'event'}>
                  <DocumentMenu
                    id={item.id}
                    name={documentLabel(item)}
                    description={item.description}
                    pinned={item.pinned}
                    focusHref={focusHref(item.id)}
                  >
                    {boxView === 'gallery' ? (
                      <DocumentGalleryRow
                        item={item}
                        href={href(item.id)}
                        selected={item.id === targetId}
                        links={links}
                      />
                    ) : (
                      <DocumentRow
                        item={item}
                        href={href(item.id)}
                        selected={item.id === targetId}
                        mode={viewMode}
                        links={links}
                      />
                    )}
                  </DocumentMenu>
                </TagDrop>
              ))}
            </section>
          ) : null}

          {groupByDay(unpinned, (i) => i.capturedAt).map((day) => (
            <section key={day.key}>
              <DayHeading label={day.label} />

              {/* Under the date, above the entries: it is about the day, not
                  one of the things that arrived in it. */}
              <DayJournal day={day.key} note={dayNotes.get(day.key) ?? ''} />

              {/* The day headings survive the gallery: arrival is the filing
                  system here, and a wall of thumbnails with no sense of when
                  is a folder, not a box. */}
              {boxView === 'gallery' ? (
                day.items.map((item) => (
                  <TagDrop
                    key={item.id}
                    itemId={item.id}
                    label={documentLabel(item)}
                    accepts={item.kind !== 'event'}
                  >
                  <DocumentMenu
                    id={item.id}
                    name={documentLabel(item)}
                    description={item.description}
                    pinned={item.pinned}
                    focusHref={focusHref(item.id)}
                  >
                    <DocumentGalleryRow
                      item={item}
                      href={href(item.id)}
                      selected={item.id === targetId}
                      links={links}
                    />
                  </DocumentMenu>
                  </TagDrop>
                ))
              ) : (
                day.items.map((item) => (
                  <TagDrop
                    key={item.id}
                    itemId={item.id}
                    label={documentLabel(item)}
                    accepts={item.kind !== 'event'}
                  >
                  <DocumentMenu
                    id={item.id}
                    name={documentLabel(item)}
                    description={item.description}
                    pinned={item.pinned}
                    focusHref={focusHref(item.id)}
                  >
                    <DocumentRow
                      item={item}
                      href={href(item.id)}
                      selected={item.id === targetId}
                      mode={viewMode}
                      links={links}
                    />
                  </DocumentMenu>
                  </TagDrop>
                ))
              )}
            </section>
          ))}
          </>
        )}
      </ListPane>

      {selected || opened ? (
        <DetailPane>
          {/*
            What is open, and the way back.

            A link followed from a note replaces the entry in pane three, which
            is exactly what was wanted - you stay in the feed and the third
            column answers the question. But a pane that has quietly become
            something else with nothing saying so is a pane you get lost in, so
            the swap announces itself and offers the entry back by name.

            Rendered above both branches rather than inside either: what it says
            is true of the pane, not of the thing in it.
          */}
          {opened ? (
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-grey-200 pb-2">
              <span className="shrink-0 text-[11px] uppercase tracking-wider text-grey-400">
                {opened.kind === 'project'
                  ? 'Project'
                  : opened.kind === 'action'
                    ? 'Action'
                    : opened.kind === 'boxItem'
                      ? `In ${openEntry?.boxName ?? 'another box'}`
                      : (openFolder?.name ?? 'Drive folder')}
                , from a note
              </span>

              {/*
                A folder is the one thing here the app does not own, so it
                always offers the way out - the same rule every row inside a
                tree follows, and the reason a tree is a snapshot rather than a
                copy.
              */}
              {opened.kind === 'drive' ? (
                <a
                  href={`https://drive.google.com/drive/folders/${opened.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[11px] text-selected underline underline-offset-2"
                >
                  Open in Drive
                </a>
              ) : null}
              {selected ? (
                /*
                 * Truncated, because a note has no title - `documentLabel`
                 * falls back to its whole first line, and the entry you came
                 * from is very often a note. Left ragged it pushed the label
                 * beside it off the pane and read as a sentence rather than as
                 * a way back.
                 */
                <Link
                  href={href(selected.id)}
                  className="min-w-0 truncate text-[11px] text-selected underline underline-offset-2"
                >
                  Back to {documentLabel(selected)}
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* key: the panel seeds its title and summary drafts from the row,
              and `useState` initialisers only run on mount. Without it,
              clicking a second document would save the first one's title
              onto it. */}
          {opened?.kind === 'drive' ? (
            /*
             * One component draws all three trees.
             *
             * A project's folder, a project's label and a linked folder are the
             * same thing to somebody reading down them, so this is the project
             * tree with its Gmail side empty rather than a second renderer to
             * keep in agreement.
             */
            <div className="-mx-4 h-full min-h-0">
              <GoogleTree
                drive={openFolder?.tree ?? null}
                gmail={null}
                fetchedAt={openFolder?.fetchedAt ?? null}
                error={openFolder?.error ?? null}
                emptyNote="Nothing has been walked yet. Run Linked folders in the bridge panel — the app cannot read a Drive folder it did not fill, so an Apps Script does it and posts back what it found."
              />
            </div>
          ) : openEntry ? (
            <DocumentDetail
              key={openEntry.id}
              item={openEntry}
              categories={entryCategories}
              boxes={boxList}
              projects={projectOptions}
              linkTargets={linkTargets}
              openBase={openBase}
            />
          ) : openAction && actionPane ? (
            <ActionDetail
            queue={actionQueue}
              key={openAction.id}
              action={openAction}
              attachments={actionPane[0].rows}
              fileOrder={actionPane[0].order}
              documents={actionPane[1].rows}
              docOrder={actionPane[1].order}
              documentOptions={actionPane[2]}
              contextGroups={actionPane[3]}
              parties={actionPane[3].person.map((party) => party.name)}
              projects={projectOptions}
            />
          ) : timeline && timeline[0] ? (
            <ProjectDetail
              /* Keyed on the project, not the row: two milestones for the same
                 project are two rows and one thing to look at. */
              key={timeline[0].id}
              project={timeline[0]}
              attachments={timeline[3].rows}
              fileOrder={timeline[3].order}
              documents={timeline[4].rows}
              docOrder={timeline[4].order}
              documentOptions={timeline[5]}
              stalled={
                timeline[0].status === 'active' &&
                !timeline[1].some((step: { status: string }) => step.status === 'next')
              }
              horizons={timeline[2]}
              boxes={timeline[6]}
              timelines={timeline[7]}
              tree={
                timeline[8]
                  ? {
                      drive: timeline[8].drive,
                      gmail: timeline[8].gmail,
                      fetchedAt: timeline[8].fetchedAt.toISOString(),
                      error: timeline[8].error,
                    }
                  : null
              }
            />
          ) : opened ? (
            /*
             * A token that names nothing.
             *
             * The project was deleted, or the id was mistyped into the editor by
             * hand. Saying so beats an empty pane: the note is still right about
             * having pointed somewhere, and the only useful thing left to say is
             * that the somewhere has gone.
             */
            <p className="text-[13px] text-grey-500">
              That{' '}
              {opened.kind === 'boxItem'
                ? 'entry has been thrown away'
                : `${opened.kind} no longer exists`}
              .
            </p>
          ) : selected ? (
            <DocumentDetail
              key={selected.id}
              item={selected}
              categories={categories}
              boxes={boxList}
              projects={projectOptions}
              linkTargets={linkTargets}
              openBase={openBase}
            />
          ) : null}
        </DetailPane>
      ) : (
        <EmptyDetail message="Select a document" />
      )}
    </>
  );
}
