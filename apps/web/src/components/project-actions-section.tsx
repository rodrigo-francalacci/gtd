import { ActionBucket } from '@/components/action-bucket';
import { QuickAddAction } from '@/components/quick-add';
import { SortableActionList } from '@/components/sortable-action-list';
import type { ActionRow } from '@/lib/queries';

/**
 * A project's actions, split into what's live and what's parked.
 *
 * Two buckets rather than one list because "I'll need to do this eventually"
 * and "I could do this now" are different commitments. Future actions stay
 * recorded and visible on the project, but never reach the Now view — and
 * they deliberately don't satisfy the stalled check, so a project whose only
 * remaining steps are future still asks for a real next action.
 *
 * Dragging between the buckets changes the status; dragging inside one
 * reorders.
 */
export function ProjectActionsSection({
  projectId,
  actions,
  archived = false,
}: {
  projectId: string;
  actions: ActionRow[];
  archived?: boolean;
}) {
  const active = actions.filter(
    (a) => a.status === 'next' || a.status === 'waiting',
  );
  const future = actions.filter((a) => a.status === 'future');
  const done = actions.filter((a) => a.status === 'done');

  const href = (id: string) => `/now?action=${id}`;
  const withHref = (rows: ActionRow[]) =>
    rows.map((a) => ({ ...a, href: href(a.id) }));

  if (archived) {
    // A finished project is a record, not a workspace — one list, done first.
    const ordered = [...done, ...future, ...active];
    return (
      <section className="mt-8 border-t border-grey-150 pt-5">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          What was done
        </h2>
        <div className="overflow-hidden rounded-sm border border-grey-200">
          <SortableActionList
            actions={withHref(ordered)}
            showProject={false}
            emptyState={
              <p className="px-4 py-3 text-[12px] text-grey-500">
                No actions were recorded on this project.
              </p>
            }
          />
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8 space-y-4 border-t border-grey-150 pt-5">
      <ActionBucket
        status="next"
        title="Active"
        hint="in “what can I do now”"
        count={active.length}
      >
        <QuickAddAction projectId={projectId} />
        <SortableActionList
          actions={withHref(active)}
          showProject={false}
          emptyState={
            <p className="px-4 py-3 text-[12px] text-grey-500">
              No open actions. Add the very next physical step above, or drag one
              up from Future.
            </p>
          }
        />
      </ActionBucket>

      <ActionBucket
        status="future"
        title="Future"
        hint="parked, not forgotten"
        count={future.length}
      >
        <SortableActionList
          actions={withHref(future)}
          showProject={false}
          emptyState={
            <p className="px-4 py-3 text-[12px] text-grey-500">
              Nothing parked. Drag an action here to keep it out of the way
              without losing it.
            </p>
          }
        />
      </ActionBucket>

      {done.length > 0 ? (
        <details className="rounded-sm border border-grey-200">
          <summary className="cursor-pointer border-b border-grey-200 bg-grey-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-grey-600">
            Done
            <span className="ml-1.5 tabular-nums text-grey-400">{done.length}</span>
          </summary>
          <SortableActionList actions={withHref(done)} showProject={false} />
        </details>
      ) : null}
    </section>
  );
}
