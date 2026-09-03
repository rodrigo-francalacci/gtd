'use client';

import { useRef, useState, useTransition } from 'react';
import {
  clarifyInboxItem,
  suggestClarifyContexts,
  type ClarifyDecision,
} from '@/lib/actions';
import type { ListOrder } from '@/lib/file-lists';
import type { AttachmentRow } from '@/lib/queries.shared';
import type { Context } from '@gtd/db';
import { Attachments } from './attachments';

type Kind = ClarifyDecision['kind'];

const ACTIONABLE: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'next_action', label: 'Next action', hint: 'The very next physical step' },
  { kind: 'waiting', label: 'Waiting for', hint: 'Someone else owes you this' },
  { kind: 'project', label: 'Project', hint: 'More than one step' },
  { kind: 'done', label: 'Did it', hint: 'Under two minutes — already done' },
];

const NOT_ACTIONABLE: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'list_item', label: 'Park on a list', hint: 'Someday, reference, purchases' },
  /*
   * The answer that was missing. Everything else here turns a capture into
   * something you have to *do*, and often the honest answer is that you do not
   * have to do anything with it and would like to find it again — which is
   * what a box is for. Without this, a receipt photographed on the way past
   * had to be trashed or made into a fake action.
   */
  { kind: 'filed', label: 'File in a box', hint: 'Reference — keep it, do nothing' },
  /*
   * The only decision here that creates nothing.
   *
   * Everything else answers "what should this become"; this answers "this
   * belongs on that". It is what a photographed receipt or a scanned quote
   * usually needs: it is evidence for work you already have, and the only way
   * to get it there before was to invent a second action to carry it.
   */
  {
    kind: 'attached',
    label: 'Attach it to…',
    hint: 'A file for a project you already have',
  },
  { kind: 'trashed', label: 'Trash', hint: 'No action, no value' },
];

export function ClarifyPanel({
  item,
  attachments,
  fileOrder,
  projects,
  actions,
  areas,
  lists,
  boxes,
  contextGroups,
}: {
  item: {
    id: string;
    rawText: string | null;
    createdAt: Date;
    aiSuggestion: {
      projectId?: string;
      contextIds?: string[];
      confidence?: number;
    } | null;
  };
  attachments: AttachmentRow[];
  /** How the captured-files list is ordered. */
  fileOrder?: ListOrder;
  projects: { id: string; title: string }[];
  /**
   * Every open action, with the project it belongs to.
   *
   * Passed in whole and narrowed here rather than fetched per project: the
   * picker has to react to the project you just chose, and a round trip between
   * two selects is exactly the friction this decision exists to remove.
   */
  actions: { id: string; title: string; projectId: string | null }[];
  areas: { id: string; name: string }[];
  lists: { id: string; name: string; type: string }[];
  boxes: { id: string; name: string }[];
  contextGroups: {
    time: Context[];
    energy: Context[];
    person: Context[];
  };
}) {
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<Kind | null>(null);
  /** Which action inside the chosen project, or '' for the project itself. */
  const [attachActionId, setAttachActionId] = useState('');

  // The suggestion pre-fills; it never commits anything on its own. A capture
  // with no note — a photo on its own — borrows the file's name, which is
  // usually better than an empty box and always editable.
  const [title, setTitle] = useState(
    (item.rawText ?? '').split('\n')[0].trim() || attachments[0]?.name || '',
  );

  /**
   * Everything after the first line. It travels onto whatever the capture
   * becomes, so the reason you wrote something down survives the moment it
   * turns into a commitment — which is precisely when you stop remembering it.
   */
  const [note, setNote] = useState(
    (item.rawText ?? '').split('\n').slice(1).join('\n').trim(),
  );
  const [projectId, setProjectId] = useState(item.aiSuggestion?.projectId ?? '');
  const [areaId, setAreaId] = useState('');
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const [boxId, setBoxId] = useState(boxes[0]?.id ?? '');
  const [contextIds, setContextIds] = useState<string[]>(
    item.aiSuggestion?.contextIds ?? [],
  );

  /**
   * Whether the contexts have been guessed for this capture yet.
   *
   * A ref rather than state: it only ever stops a second request, and putting
   * it in state would re-render the pane for a fact nothing draws. Keyed on the
   * item so moving down the queue asks again — this component is remounted per
   * row by its `key`, but the guard has to be right either way.
   */
  const guessed = useRef<string | null>(null);
  const [guessing, setGuessing] = useState(false);

  /**
   * Ask for Where, Time and Energy the moment you say it is actionable.
   *
   * Here rather than at capture, because pressing one of these three buttons is
   * what makes the fields worth filling in — guessing for every thought would
   * spend money on the ones that turn out to be rubbish. And it is the moment
   * the guess is cheapest to check, since the pane is already open.
   *
   * Whatever comes back is *merged under* what you have already picked: the
   * request is in flight while the pane is usable, so a suggestion arriving
   * after you have chosen something must not undo it. `who` is never
   * suggested and so is never disturbed.
   */
  const choose = (next: Kind | null) => {
    setKind(next);

    if (next !== 'next_action' && next !== 'waiting' && next !== 'project') return;
    if (guessed.current === item.id) return;

    guessed.current = item.id;
    setGuessing(true);

    void suggestClarifyContexts(item.id)
      .then((ids) => {
        setContextIds((current) => [
          ...current,
          ...ids.filter((id) => !current.includes(id)),
        ]);
      })
      .catch(() => {
        // Three empty rows is exactly what this replaced, and is fine.
      })
      .finally(() => setGuessing(false));
  };

  const suggestedProject = projects.find((p) => p.id === item.aiSuggestion?.projectId);

  const toggleContext = (id: string) =>
    setContextIds((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );

  const confirm = () => {
    if (!kind) return;

    let decision: ClarifyDecision;
    if (kind === 'trashed') decision = { kind: 'trashed' };
    else if (kind === 'attached') {
      /*
       * An action if one was picked, otherwise the project itself. Both are
       * ordinary attachment parents, so nothing downstream has to know which
       * of the two you chose.
       */
      if (!projectId) return;
      decision = attachActionId
        ? { kind, parentType: 'action', parentId: attachActionId }
        : { kind, parentType: 'project', parentId: projectId };
    }
    else if (kind === 'project')
      decision = { kind, title, areaId: areaId || null, note };
    else if (kind === 'list_item') {
      if (!listId) return;
      decision = { kind, title, listId, note };
    } else if (kind === 'filed') {
      if (!boxId) return;
      decision = { kind, title, boxId, note };
    } else
      decision = { kind, title, projectId: projectId || null, contextIds, note };

    startTransition(async () => {
      await clarifyInboxItem(item.id, decision);
      setKind(null);
    });
  };

  /** The actions in the chosen project, which is what the second picker offers. */
  const actionsHere = actions.filter((a) => a.projectId === projectId);

  /**
   * The one-click exits.
   *
   * Most of what lands in an inbox is not a project needing a title, a parent
   * and three contexts — it is rubbish, something already done, or something
   * for later. Making those go through the full form is why inboxes stop
   * getting emptied, and emptying it is the step that actually decays.
   */
  const somedayList = lists.find((l) => l.type === 'someday_maybe');
  const quickTitle = title.trim();

  const quickFile = (decision: ClarifyDecision) =>
    startTransition(async () => {
      await clarifyInboxItem(item.id, decision);
      setKind(null);
    });

  const quickNote = note;

  /*
   * Attaching asks for neither a title nor a note.
   *
   * The words you typed to get the file into the inbox were a label for the
   * capture — "receipt", "the quote" — and writing them onto the project as a
   * note would be filing your shorthand as a thought. The file is the thing
   * that crosses; the capture keeps its own text, where you wrote it.
   */
  const needsTitle = kind !== null && kind !== 'trashed' && kind !== 'attached';
  const dimensions: { key: keyof typeof contextGroups; label: string }[] = [
    { key: 'time', label: 'Time' },
    { key: 'energy', label: 'Energy' },
    { key: 'person', label: 'Who' },
  ];

  return (
    <div className={pending ? 'opacity-60' : ''}>
      {/* The raw capture, shown as a quotation and never editable — it is the
          record of what you actually thought. Everything below is a layer on
          top of it. */}
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Captured{' '}
          {new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(item.createdAt)}
        </h2>
        {item.rawText ? (
          <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-grey-300 pl-3 text-[15px] leading-relaxed text-grey-800">
            {item.rawText}
          </blockquote>
        ) : (
          <p className="mt-2 border-l-2 border-grey-300 pl-3 text-[13px] italic text-grey-500">
            No note — the file below is the capture.
          </p>
        )}
      </section>

      {/* The quick exits sit above the form, because most captures deserve one
          of them and should never have to scroll past a project picker. */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-wider text-grey-400">
          Quick
        </span>
        <QuickButton
          label="Did it"
          hint="Already done — records it and clears the capture"
          disabled={pending || !quickTitle}
          onClick={() =>
            quickFile({
              kind: 'done',
              title: quickTitle,
              projectId: null,
              contextIds: [],
              note: quickNote,
            })
          }
        />
        <QuickButton
          label="Someday"
          hint={
            somedayList
              ? `Park it on ${somedayList.name}`
              : 'No Someday/Maybe list exists yet'
          }
          disabled={pending || !quickTitle || !somedayList}
          onClick={() =>
            somedayList &&
            quickFile({
              kind: 'list_item',
              title: quickTitle,
              listId: somedayList.id,
              note: quickNote,
            })
          }
        />
        <QuickButton
          label="Trash"
          hint="No action, no value — the capture stays in the record"
          disabled={pending}
          onClick={() => quickFile({ kind: 'trashed' })}
        />
      </div>

      <p className="mt-5 text-[13px] font-medium text-grey-800">Is it actionable?</p>

      <div className="mt-2 space-y-3">
        <Row
          options={ACTIONABLE}
          selected={kind}
          onSelect={choose}
          heading="Yes"
        />
        <Row
          options={NOT_ACTIONABLE}
          selected={kind}
          onSelect={choose}
          heading="No"
        />
      </div>

      {kind ? (
        <section className="mt-5 rounded-sm border border-grey-300 bg-grey-50 px-3 py-3">
          {kind === 'attached' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] leading-relaxed text-grey-600">
                {attachments.length === 0 ? (
                  <>
                    This capture has no file on it. Attaching would move nothing
                    — clarify it another way, or add a file above first.
                  </>
                ) : (
                  <>
                    {attachments.length === 1
                      ? 'The file goes'
                      : `All ${attachments.length} files go`}{' '}
                    onto whatever you pick, and the capture is marked dealt with.
                    Nothing new is created, and the note you typed stays here.
                  </>
                )}
              </p>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                  Project
                </label>
                <select
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    // The actions listed below belong to the old project.
                    setAttachActionId('');
                  }}
                  className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                >
                  <option value="">Choose a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {/*
                The second picker is optional and only appears once there is
                something to pick from. A project with no open actions would
                otherwise show an empty select that looks like a thing you have
                failed to fill in.
              */}
              {projectId && actionsHere.length > 0 ? (
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                    On an action, or the project itself
                  </label>
                  <select
                    value={attachActionId}
                    onChange={(e) => setAttachActionId(e.target.value)}
                    className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                  >
                    <option value="">The project itself</option>
                    {actionsHere.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : needsTitle ? (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                {kind === 'project'
                  ? 'Project title'
                  : kind === 'list_item'
                    ? 'Item'
                    : 'Action — start with a verb'}
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
              />
            </div>
          ) : (
            <p className="text-[12px] text-grey-600">
              The capture stays in the record, marked as trashed. Nothing is
              deleted.
            </p>
          )}

          {needsTitle ? (
            <div className="mt-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                Note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Anything worth remembering about it — carried over to the notes."
                className="mt-1 w-full resize-none rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] leading-relaxed focus:border-grey-500 focus:outline-none"
              />
            </div>
          ) : null}

          {kind === 'next_action' || kind === 'waiting' || kind === 'done' ? (
            <>
              <div className="mt-3">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                  Project
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                {suggestedProject && projectId === suggestedProject.id ? (
                  <p className="mt-1 text-[11px] text-grey-500">
                    Suggested from the text — change it if that&apos;s wrong.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                  Contexts
                  {/*
                    Said out loud while it happens, and only while it happens.
                    Three chips lighting up on their own a second after you
                    pressed something else is the app appearing to have a mind
                    of its own; a word saying what it is doing makes it a
                    suggestion you were told about.
                  */}
                  {guessing ? (
                    <span className="ml-2 font-normal normal-case tracking-normal text-grey-400">
                      guessing…
                    </span>
                  ) : null}
                </span>
                {dimensions.map(({ key, label }) => {
                  const items = contextGroups[key];
                  if (items.length === 0) return null;
                  return (
                    <div key={key} className="flex items-baseline gap-2">
                      <span className="w-11 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
                        {label}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {items.map((c) => {
                          const on = contextIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleContext(c.id)}
                              className={[
                                'rounded-sm border px-1.5 py-px text-[11px]',
                                on
                                  ? 'border-grey-700 bg-grey-700 text-paper'
                                  : 'border-grey-300 text-grey-600 hover:border-grey-500',
                              ].join(' ')}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {kind === 'project' ? (
            <div className="mt-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                Area of focus
              </label>
              <select
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
              >
                <option value="">No area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {kind === 'list_item' ? (
            <div className="mt-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                List
              </label>
              {lists.length === 0 ? (
                <p className="mt-1 text-[12px] text-stale">
                  No lists yet — create one under Manage lists first.
                </p>
              ) : (
                <select
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {kind === 'filed' ? (
            <div className="mt-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                Box
              </label>
              {boxes.length === 0 ? (
                <p className="mt-1 text-[12px] text-stale">
                  No boxes yet — make one under Manage boxes first.
                </p>
              ) : (
                <>
                  <select
                    value={boxId}
                    onChange={(e) => setBoxId(e.target.value)}
                    className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                  >
                    {boxes.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-grey-500">
                    {attachments.length > 0
                      ? `${attachments.length === 1 ? 'The file becomes a document' : `Each of the ${attachments.length} files becomes a document`} in the box, read and tagged like anything else filed there. What you typed is kept beside ${attachments.length === 1 ? 'it' : 'the first'}.`
                      : 'This becomes a note in the box — kept and searchable, with nothing to do.'}
                  </p>
                </>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={
                pending ||
                (needsTitle && !title.trim()) ||
                (kind === 'list_item' && !listId) ||
                (kind === 'filed' && !boxId)
              }
              className="rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper disabled:opacity-40"
            >
              {kind === 'trashed' ? 'Trash it' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setKind(null)}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {/* Files can be added here too, not only at capture — a photo you meant
          to take at the time, or a PDF the thought was really about. They
          follow the decision to whatever the capture becomes. */}
      <Attachments
        parentType="inbox_item"
        parentId={item.id}
        rows={attachments}
        label="Captured files"
        sort={fileOrder?.sort}
        sortKey={fileOrder?.viewKey}
        groups={fileOrder?.groups}
      />
    </div>
  );
}

function QuickButton({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      disabled={disabled}
      onClick={onClick}
      className="rounded-sm border border-grey-300 px-2 py-0.5 text-[11px] text-grey-600 hover:border-grey-500 hover:text-grey-800 disabled:opacity-40 disabled:hover:border-grey-300"
    >
      {label}
    </button>
  );
}

function Row({
  heading,
  options,
  selected,
  onSelect,
}: {
  heading: string;
  options: { kind: Kind; label: string; hint: string }[];
  selected: Kind | null;
  onSelect: (kind: Kind) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-6 shrink-0 pt-1 text-[10px] uppercase tracking-wider text-grey-400">
        {heading}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            title={o.hint}
            onClick={() => onSelect(o.kind)}
            className={[
              'rounded-sm border px-2 py-1 text-[12px]',
              selected === o.kind
                ? 'border-grey-800 bg-grey-800 text-paper'
                : 'border-grey-300 text-grey-600 hover:border-grey-500',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
