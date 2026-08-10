import Link from 'next/link';
import { NewListForm } from '@/components/new-list-form';
import { DetailPane, EmptyList, ListPane } from '@/components/panes';
import { LIST_TYPE_LABELS, getLists } from '@/lib/queries';

export default async function ListsPage() {
  const lists = await getLists();

  return (
    <>
      <ListPane title="Lists" subtitle={`${lists.length} list${lists.length === 1 ? '' : 's'}`}>
        {lists.length === 0 ? (
          <EmptyList message="No lists yet. Create one on the right." />
        ) : (
          lists.map((l) => (
            <Link
              key={l.id}
              href={`/lists/${l.id}`}
              className="block border-b border-grey-150 px-4 py-2.5 hover:bg-grey-100"
            >
              <span className="block truncate text-[13px] text-grey-800">{l.name}</span>
              <span className="mt-1 block text-[11px] text-grey-500">
                {LIST_TYPE_LABELS[l.type]} · {l.candidateCount} candidate
                {l.candidateCount === 1 ? '' : 's'} of {l.itemCount}
              </span>
            </Link>
          ))
        )}
      </ListPane>

      <DetailPane>
        <h1 className="text-xl font-semibold text-grey-900">New list</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
          Everything on a list is a candidate. Items become real work only when
          promoted, which spawns an action and links the two.
        </p>
        <div className="mt-6">
          <NewListForm />
        </div>
      </DetailPane>
    </>
  );
}
