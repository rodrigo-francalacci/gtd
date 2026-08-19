import { BoxManager } from '@/components/box-manager';
import { BoxSetup } from '@/components/box-setup';
import { NewBoxForm } from '@/components/box-manager';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { getBoxCategories, getBoxes } from '@/lib/queries';
import { getBoxQueueStatus } from '@/lib/box/queue';
import Link from 'next/link';

/**
 * Where boxes and their tag vocabularies are managed.
 *
 * The vocabulary is user data, not an enum — the same call as contexts. What
 * makes it matter more here is that the model is only allowed to *use* these
 * lists: editing them is the only way the tagging changes.
 */
export default async function BoxesPage(props: PageProps<'/box'>) {
  const searchParams = await props.searchParams;
  const selectedId = typeof searchParams.box === 'string' ? searchParams.box : null;

  const boxes = await getBoxes();

  if (boxes.length === 0) {
    return (
      <>
        <ListPane title="Big Box">
          <EmptyList message="Nothing set up yet." />
        </ListPane>
        <DetailPane>
          <BoxSetup />
        </DetailPane>
      </>
    );
  }

  const target = boxes.find((b) => b.id === selectedId) ?? boxes[0];
  const [categories, queue] = await Promise.all([
    getBoxCategories(target.id),
    getBoxQueueStatus(),
  ]);

  return (
    <>
      <ListPane
        title="Big Box"
        subtitle={
          queue.configured
            ? `${boxes.length} box${boxes.length === 1 ? '' : 'es'}`
            : 'No API key set — documents are filed but not read.'
        }
      >
        {boxes.map((box) => (
          <Link
            key={box.id}
            href={`/box?box=${box.id}`}
            className={[
              'block border-b border-grey-150 px-4 py-2.5',
              box.id === target.id ? 'bg-selected-bg' : 'hover:bg-grey-100',
            ].join(' ')}
          >
            <span
              className={[
                'block truncate text-[13px]',
                box.id === target.id
                  ? 'font-medium text-grey-900'
                  : 'text-grey-800',
              ].join(' ')}
            >
              {box.name}
            </span>
            <span className="mt-1 flex items-center gap-2 text-[11px] text-grey-500">
              <span>
                {box.itemCount} document{box.itemCount === 1 ? '' : 's'}
              </span>
              {box.pendingCount > 0 ? (
                <span className="text-grey-400">{box.pendingCount} unread</span>
              ) : null}
              {box.isDefault ? (
                <span className="rounded-sm bg-grey-200 px-1.5 py-px text-grey-600">
                  default
                </span>
              ) : null}
            </span>
          </Link>
        ))}

        <NewBoxForm />
      </ListPane>

      {target ? (
        <DetailPane>
          {/* key: the manager seeds its name and instruction drafts from the
              box, and a `useState` initialiser only runs on mount. */}
          <BoxManager key={target.id} box={target} categories={categories} />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select a box" />
      )}
    </>
  );
}
