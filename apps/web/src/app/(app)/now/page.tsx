import Link from 'next/link';
import { ActionDetail } from '@/components/action-detail';
import { BackTrail } from '@/components/back-trail';
import { Board } from '@/components/board';
import { FocusView } from '@/components/focus-view';
import { NoteEditor } from '@/components/note-editor';
import { updateActionNotes } from '@/lib/actions';
import { SortableActionList } from '@/components/sortable-action-list';
import { EmojifyButton } from '@/components/emojify-button';
import { ContextFilter } from '@/components/context-filter';
import { ListKeys } from '@/components/list-keys';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { QuickAddAction } from '@/components/quick-add';
import {
  AddNowSection,
  NowLoose,
  NowScheduled,
  NowSection,
} from '@/components/now-sections';
import { ACTION_COLUMNS } from '@/lib/columns';
import { standingOf } from '@/lib/queries.shared';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { deleteAction } from '@/lib/actions';
import { getNowSections, getProjectOptions } from '@/lib/queries';
import {
  getActionQueue,
  getAction,
  getBackTrail,
  getContextsByDimension,
  getDeferredActions,
  getNowActions,
  getLinkableDocuments,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

export default async function NowPage(props: PageProps<'/now'>) {
  const searchParams = await props.searchParams;

  const raw = searchParams.ctx;
  const contextIds = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  /*
   * The same page asked the opposite question.
   *
   * `?filter=later` lists what has been put off rather than what is live —
   * the shape "Stalled" already takes on `/projects`, and for the same reason:
   * it is a view of the same rows, not a page of its own, and the sidebar is
   * the only way in. Deferral must never be a way to lose something, and a
   * feature that hides rows with nowhere to see them is exactly that.
   */
  const later = searchParams.filter === 'later';

  const viewKey = densityKeys.path('/now');
  const [groups, rows, sections, selected, prefs, view] = await Promise.all([
    getContextsByDimension(),
    later ? getDeferredActions() : getNowActions(contextIds),
    getNowSections(),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
    getPreferences(),
    getView(viewKey),
  ]);
  const viewMode = view.density ?? prefs.viewMode;

  /**
   * One builder for every address this page hands out.
   *
   * The context filter has to survive selecting a row, opening the board,
   * clicking empty space on it and closing it again — and four separate
   * constructions of the same query string is how one of them quietly stops
   * carrying the filter.
   */
  const nowUrl = (opts: { board?: boolean; action?: string | null }) => {
    const p = new URLSearchParams();
    contextIds.forEach((c) => p.append('ctx', c));
    if (opts.action) p.set('action', opts.action);
    if (opts.board) p.set('board', '1');
    // Or clicking a row in the deferred view would silently drop you back into
    // the live list, with the row you chose no longer in it.
    if (later) p.set('filter', 'later');
    const query = p.toString();
    return query ? `/now?${query}` : '/now';
  };

  const qs = (id: string) => nowUrl({ action: id });

  /** The same row with the window given over to it, filters intact. */
  const focusOf = (id: string) => `${nowUrl({ action: id })}&focus=1`;

  /*
   * Cut into the headings you made, in their order, with everything else last.
   *
   * In memory rather than in SQL: the rows are already fetched and already
   * ordered, and grouping them here keeps `getNowActions` a single query that
   * knows nothing about an arrangement no other page uses.
   */
  /*
   * What you have committed to today comes out of the pool first.
   *
   * Today and anything overdue, in clock order, above everything — because
   * "what did I say I would do now" is a different and louder question than
   * "what could I do now", and a commitment mixed into a list of forty is not
   * a commitment. Anything booked for a later day stays exactly where it is,
   * with its date on the row: lifting those here would fill the block with
   * things that are not today's, which is how a calendar stops being read.
   *
   * Taken out of `rows` rather than drawn twice, or the arrows would walk past
   * each of them once in each place.
   */
  const booked = (later ? [] : rows)
    .filter((a) => {
      const standing = standingOf(a.scheduledAt);
      return standing === 'today' || standing === 'overdue';
    })
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));

  const bookedIds = new Set(booked.map((a) => a.id));
  const pool = rows.filter((a) => !bookedIds.has(a.id));
  /*
   * Late is measured against the clock, not against the day.
   *
   * `standingOf` cuts in whole days because that decides *where* a row is
   * drawn — today's bookings lift, later ones stay in the pool. Whether one
   * has been missed is a different question with a different unit: a slot at
   * seven this morning, read at four in the afternoon, has been and gone, and
   * saying "none gone by" over it would be the header stating something false.
   */
  const now = Date.now();
  const late = booked.filter((a) => (a.scheduledAt?.getTime() ?? 0) < now).length;

  const bySection = new Map<string, typeof rows>();
  const loose: typeof rows = [];

  for (const action of pool) {
    // In the deferred view nothing is grouped: the order is the day each row
    // comes back, and an arrangement of the live list has nothing to say about
    // rows that are not in it.
    if (!later && action.sectionId && sections.some((s) => s.id === action.sectionId)) {
      bySection.set(action.sectionId, [
        ...(bySection.get(action.sectionId) ?? []),
        action,
      ]);
    } else {
      // Including an action pointing at a heading that has gone: it is loose,
      // which is what `on delete set null` will make it on the next write.
      loose.push(action);
    }
  }

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const projectOptions = await getProjectOptions();
  const files = selected ? await attachmentsFor('action', selected.id) : null;
  const docs = selected ? await documentsFor('action', selected.id) : null;

  /* What the selected step becomes when it is ticked off. */
  const actionQueue = selected ? await getActionQueue(selected.id) : undefined;

  /**
   * The board, and it only means anything once there are headings.
   *
   * A section is an *arrangement* — "after sorting the money", "once the parts
   * arrive" — and the work of keeping one is moving actions between headings as
   * things unblock. Stacked down a pane that is a drag across two scrolls; side
   * by side it is one short movement. With no headings there is nothing to move
   * *between*, so there is no board and no button: one run of actions laid out
   * as one enormous lane would be the list, wider.
   */
  const wantsBoard = sections.length > 0 && searchParams.board !== undefined;

  const boardHref = nowUrl({ board: true, action: selectedId });
  const closeBoardHref = nowUrl({ action: selectedId });

  /*
   * Built only when there *is* one, and that is not a tidiness point.
   *
   * JSX evaluates its props at the moment the element is created, so a
   * `<ActionDetail attachments={files!.rows} …>` written unconditionally throws
   * on `files` being null the instant nothing is selected — before any branch
   * decides whether to render it. The non-null assertions hid it from the
   * compiler and the board crashed on first open.
   */
  /*
   * Where a link was followed from. Read once, above the branches, because both
   * the pane and the focus view want it and it is one query either way.
   */
  const followed = await getBackTrail(
    typeof searchParams.back === 'string' ? searchParams.back : undefined,
  );

  const detail = selected ? (
    <ActionDetail
            queue={actionQueue}
      key={selected.id}
      action={selected}
      attachments={files!.rows}
      fileOrder={files!.order}
      documents={docs!.rows}
      docOrder={docs!.order}
      documentOptions={await getLinkableDocuments('action', selected.id, '')}
      contextGroups={groups}
      parties={groups.person.map((p) => p.name)}
      projects={projectOptions}
    />
  ) : null;

  /**
   * One action, opened to work on.
   *
   * Instead of the panes rather than over them: it covers the window either
   * way, and drawing both would mount this action's note editor twice — two
   * autosaves for one document.
   */
  if (searchParams.focus !== undefined && selected && detail) {
    /*
     * Where you came from wins over what this belongs to.
     *
     * The project is a fact about the *row* and is the right trail when you
     * arrived from a list. A link is a fact about the *journey*, and when there
     * is one it is what you actually want back — following a note's link into
     * another action and being offered its project instead would be answering a
     * question you did not ask.
     */
    return (
      <FocusView
        title={selected.title}
        parent={
          (followed ? { label: followed.label, href: followed.focusHref } : undefined) ??
          (selected.projectId && selected.projectTitle
            ? {
                label: selected.projectTitle,
                href: `/projects/${selected.projectId}?focus=1`,
              }
            : undefined)
        }
        subtitle={selected.projectTitle ? 'Action' : 'No project'}
        closeHref={qs(selected.id)}
        notes={
          <NoteEditor
            key={selected.id}
            surface="action"
            id={selected.id}
            height={selected.noteHeight}
            dense={selected.noteDense}
            initialContent={selected.notes}
            onSave={updateActionNotes.bind(null, selected.id)}
            placeholder="What it depends on, what you tried, what you decided…"
            fill
          />
        }
        rest={
          <ActionDetail
            queue={actionQueue}
            key={selected.id}
            action={selected}
            attachments={files!.rows}
            fileOrder={files!.order}
            documents={docs!.rows}
            docOrder={docs!.order}
            documentOptions={await getLinkableDocuments('action', selected.id, '')}
            contextGroups={groups}
            parties={groups.person.map((p) => p.name)}
            projects={projectOptions}
            hideNotes
          />
        }
      />
    );
  }

  if (wantsBoard) {
    /*
     * The board *instead of* the panes, not on top of them.
     *
     * It covers the window either way, so drawing both would be work nobody
     * sees — and worse than wasted: the note editor in pane three would be
     * mounted twice against the same action, two autosaves for one document.
     */
    return (
      <Board
        title="What can I do now"
        subtitle={`${rows.length} action${rows.length === 1 ? '' : 's'} across ${
          sections.length
        } heading${sections.length === 1 ? '' : 's'}${
          contextIds.length > 0 ? ' · filtered' : ''
        }`}
        closeHref={closeBoardHref}
        deselectHref={nowUrl({ board: true })}
        viewMode={viewMode}
        viewKey={viewKey}
        laneCount={sections.length + 1}
        side={
          detail ?? (
            <p className="text-[13px] leading-relaxed text-grey-500">
              Select an action to read it here. Drag one between headings to say
              what has to happen first.
            </p>
          )
        }
        columns={
          <>
            {sections.map((section, at) => (
              <NowSection
                key={section.id}
                variant="column"
                id={section.id}
                title={section.title}
                count={bySection.get(section.id)?.length ?? 0}
                prevId={sections[at - 1]?.id ?? null}
              >
                <SortableActionList
                  actions={(bySection.get(section.id) ?? []).map((a) => ({
                    ...a,
                    href: nowUrl({ board: true, action: a.id }),
                  }))}
                  selectedId={selectedId}
                  mode={viewMode}
                />
              </NowSection>
            ))}

            {/*
              Always drawn, even empty — it is the only way to take an action
              back *out* of a heading, which is the rule the project status
              buckets and the impact lanes already follow.
            */}
            <NowLoose variant="column" count={loose.length}>
              <SortableActionList
                actions={loose.map((a) => ({
                  ...a,
                  href: nowUrl({ board: true, action: a.id }),
                }))}
                selectedId={selectedId}
                mode={viewMode}
              />
            </NowLoose>
          </>
        }
      />
    );
  }

  return (
    <>
      <ListPane
        title={later ? 'Put off' : 'What can I do now'}
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth(prefs)}
        columns={ACTION_COLUMNS}
        /*
         * No context filter in the deferred view. Contexts narrow "what could
         * I do right now", and nothing here is available right now — offering
         * the control would be offering to filter a list by a question it is
         * not answering.
         */
        subtitle={
          later ? (
            `${rows.length} put off, soonest first`
          ) : (
            <ContextFilter groups={groups} />
          )
        }
        /*
         * The ids are the rows the context filter has left, not every action in
         * the table — what you asked to mark is what you were looking at, and
         * re-reading the table here would quietly bill you for the ones you
         * filtered out.
         */
        actions={
          <>
            <EmojifyButton
              target="actions"
              ids={rows.map((a) => a.id)}
              marked={rows.filter((a) => a.emoji).length}
            />
            {/*
              Only once there are headings to move things between, and hidden on
              a phone — the board is four lanes you drag across, and HTML5
              drag-and-drop has no touch support anywhere in this app. A button
              opening a view you could look at and not use is worse than none.
            */}
            {sections.length > 0 ? (
              <Link
                href={boardHref}
                className="hidden text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 lg:inline"
              >
                Board
              </Link>
            ) : null}
          </>
        }
      >
        {/* Arrows walk the list; Delete asks, then removes. The order is
            this page's own, so a context filter narrows what the arrows
            walk rather than leaving them out of step with the rows. */}
        <ListKeys
          /*
           * The order the list is *drawn* in, headings and all — which stops
           * being the query's order the moment a section exists. Built from the
           * same grouping the rows below are, because two expressions of one
           * order is how the arrows end up jumping about.
           */
          rows={[
            ...booked,
            ...sections.flatMap((section) => bySection.get(section.id) ?? []),
            ...loose,
          ].map((a) => ({ id: a.id, href: qs(a.id) }))}
          selectedId={selectedId}
          onDelete={deleteAction}
          deleteLabel="Done and delete"
          deleteNote="Its files go to the Drive bin with it."
        />

        {later ? null : <QuickAddAction />}

        <NowScheduled count={booked.length} late={late}>
          <SortableActionList
            actions={booked.map((a) => ({
              ...a,
              href: qs(a.id),
              focusHref: focusOf(a.id),
            }))}
            selectedId={selectedId}
            mode={viewMode}
            /* The clock decides this order, so dragging inside it would look
               like it had done nothing. */
            sortable={false}
          />
        </NowScheduled>

        {/*
          With no headings this is the list exactly as it was — one sortable
          run, dragged into whatever order you like. Headings are opt-in and
          cost nothing until the first one exists.
        */}
        {later || sections.length === 0 ? (
          <SortableActionList
            actions={pool.map((a) => ({ ...a, href: qs(a.id), focusHref: focusOf(a.id) }))}
            selectedId={selectedId}
            mode={viewMode}
            /* The day each one comes back is the order, so dragging would look
               like it had done nothing. */
            sortable={!later}
            emptyState={
              <EmptyList
                message={
                  later
                    ? 'Nothing is put off. Set "Not until" on an action to park it here.'
                    : contextIds.length > 0
                      ? 'Nothing matches this combination of contexts. Loosen a filter.'
                      : 'No next actions. Either you are done, or something needs clarifying.'
                }
              />
            }
          />
        ) : (
          <>
            {sections.map((section, at) => (
              <NowSection
                key={section.id}
                id={section.id}
                title={section.title}
                count={bySection.get(section.id)?.length ?? 0}
                prevId={sections[at - 1]?.id ?? null}
              >
                {/*
                  A real sortable run per heading, which is what makes the
                  gesture work: dragging inside one reorders, and dragging to
                  another is ignored by the list and caught by the heading it
                  lands on — the same bubbling the project buckets rely on.
                */}
                <SortableActionList
                  actions={(bySection.get(section.id) ?? []).map((a) => ({
                    ...a,
                    href: qs(a.id),
                    focusHref: focusOf(a.id),
                  }))}
                  selectedId={selectedId}
                  mode={viewMode}
                />
              </NowSection>
            ))}

            <NowLoose count={loose.length}>
              <SortableActionList
                actions={loose.map((a) => ({ ...a, href: qs(a.id), focusHref: focusOf(a.id) }))}
                selectedId={selectedId}
                mode={viewMode}
              />
            </NowLoose>
          </>
        )}

        {/* Headings arrange the live list; there is nothing here to arrange. */}
        {later ? null : <AddNowSection />}
      </ListPane>

      {selected ? (
        <DetailPane>
          {/* Where you followed a link from, when you followed one. */}
          {followed ? <BackTrail label={followed.label} href={followed.href} /> : null}

          {/* key: `useState(action.title)` only runs on mount. */}
          <ActionDetail
            queue={actionQueue}
            key={selected.id}
            action={selected}
            attachments={files!.rows}
            fileOrder={files!.order}
            documents={docs!.rows}
            docOrder={docs!.order}
            documentOptions={await getLinkableDocuments('action', selected.id, '')}
            contextGroups={groups}
            parties={groups.person.map((p) => p.name)}
            projects={projectOptions}
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select an action" />
      )}
    </>
  );
}
