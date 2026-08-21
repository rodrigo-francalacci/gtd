import Link from 'next/link';
import { getBoxes } from '@/lib/queries';

/**
 * The boxes, as a way in rather than a place to read.
 *
 * Browsing a year of filed documents on a phone is not what a phone is for;
 * putting something *into* one while standing next to it is. So this lists the
 * boxes and hands you back to capture with that box already chosen, which is
 * the journey that actually happens — you are holding a receipt, not looking
 * for one.
 */
export default async function MobileBoxesPage() {
  const boxes = await getBoxes();

  return (
    <div className="mx-auto w-full max-w-lg">
      <header className="flex items-baseline justify-between px-4 py-3">
        <h1 className="text-[15px] font-semibold text-grey-900">Boxes</h1>
        <Link
          href="/box"
          className="text-[13px] text-grey-500 underline underline-offset-2"
        >
          Desktop
        </Link>
      </header>

      {boxes.length === 0 ? (
        <p className="px-4 py-6 text-[13px] leading-relaxed text-grey-500">
          No boxes yet. They are set up on the desktop — creating one makes a
          folder in your Drive, which is not something to do by accident on a
          phone.
        </p>
      ) : (
        <ul className="flex flex-col border-t border-grey-150">
          {boxes.map((box) => (
            <li key={box.id}>
              <Link
                href={`/box/${box.id}`}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-grey-150 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[15px] text-grey-800">
                    {box.name}
                  </span>
                  <span className="text-[12px] text-grey-500">
                    {box.itemCount} filed
                    {box.pendingCount > 0
                      ? ` · ${box.pendingCount} not read yet`
                      : ''}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-grey-300">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
