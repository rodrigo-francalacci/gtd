import { QuickAddAction } from '@/components/quick-add';
import { SortableActionList } from '@/components/sortable-action-list';
import type { ActionRow } from '@/lib/queries';

/**
 * The actions belonging to a project. Shared by the live project pane and the
 * archive — in the archive it's the record of what actually got done, so the
 * quick-add is dropped and finished items lead.
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
  const open = actions.filter((a) => a.status !== 'done');
  const done = actions.filter((a) => a.status === 'done');
  const ordered = archived ? [...done, ...open] : open;

  return (
    <section className="mt-8 border-t border-grey-150 pt-5">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        {archived ? 'What was done' : 'Actions'}
      </h2>

      <div className="overflow-hidden rounded-sm border border-grey-200">
        {archived ? null : <QuickAddAction projectId={projectId} />}

        <SortableActionList
          actions={ordered.map((a) => ({ ...a, href: `/now?action=${a.id}` }))}
          showProject={false}
          emptyState={
            <p className="px-4 py-3 text-[12px] text-grey-500">
              {archived
                ? 'No actions were recorded on this project.'
                : 'No open actions. Add the very next physical step above.'}
            </p>
          }
        />

        {archived || done.length === 0 ? null : (
          <SortableActionList
            actions={done.map((a) => ({ ...a, href: `/now?action=${a.id}` }))}
            showProject={false}
          />
        )}
      </div>
    </section>
  );
}
