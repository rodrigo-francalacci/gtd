import { notFound, redirect } from 'next/navigation';
import { boxOfEntry } from '@/lib/queries';

/**
 * A box entry, found without being told which box it is in.
 *
 * The `B<uuid>` token stores the entry and nothing else, deliberately: an entry
 * can be *moved* between boxes, and a token carrying the box would be a copy of
 * a fact that changes — the same mistake as storing a project's name. So the
 * box is looked up at the moment the link is followed, which is what makes the
 * link survive a move, a copy and a box being renamed or deleted underneath it.
 *
 * This is the fallback for a link followed from somewhere with no pane to fill.
 * Inside a box, `?open=B<uuid>` puts the entry in pane three without leaving the
 * feed; here there is nowhere to stay, so it goes to the entry's own box with
 * the entry selected.
 */
export default async function FindBoxEntryPage(props: PageProps<'/box/find/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const boxId = await boxOfEntry(id);

  // Deleted, or never existed. A 404 rather than a redirect to nowhere: the
  // link is genuinely dead and saying so is more use than an empty box.
  if (!boxId) notFound();

  /*
   * The flag rides through the lookup. Without it, following a link to a box
   * entry from the focus view would resolve correctly and then land you in the
   * panes — the one destination of the four that changed shape on the way.
   */
  const focused = searchParams.focus !== undefined ? '&focus=1' : '';

  redirect(`/box/${boxId}?doc=${id}${focused}`);
}
