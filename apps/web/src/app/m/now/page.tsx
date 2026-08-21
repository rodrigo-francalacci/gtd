import Link from 'next/link';
import { getContextsByDimension, getNowActions } from '@/lib/queries';
import { MobileNow } from '@/components/mobile-now';

/**
 * What can I do now, on a phone.
 *
 * The one view besides capture that is genuinely *better* here than at a desk:
 * the question it answers — what can I do, in this place, with this much time —
 * is one you ask standing in a shop with fifteen minutes, not sitting in front
 * of a monitor. Everything the desktop wraps around it (drag to file, the
 * project pane, the three columns) is absent on purpose.
 */
export default async function MobileNowPage(props: PageProps<'/m/now'>) {
  const searchParams = await props.searchParams;

  const raw = searchParams.ctx;
  const contextIds = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  const [groups, actions] = await Promise.all([
    getContextsByDimension(),
    getNowActions(contextIds),
  ]);

  return (
    <div className="mx-auto w-full max-w-lg">
      <header className="flex items-baseline justify-between px-4 py-3">
        <h1 className="text-[15px] font-semibold text-grey-900">
          What can I do now
          <span className="ml-1.5 text-[13px] font-normal tabular-nums text-grey-400">
            {actions.length}
          </span>
        </h1>
        <Link
          href="/now"
          className="text-[13px] text-grey-500 underline underline-offset-2"
        >
          Desktop
        </Link>
      </header>

      <MobileNow groups={groups} actions={actions} selected={contextIds} />
    </div>
  );
}
