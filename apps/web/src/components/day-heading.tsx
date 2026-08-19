/**
 * The centred date chip, as every messaging app has trained everyone to read.
 *
 * Sticky, with the pane's own background behind it, so scrolling a long feed
 * always leaves the day you are looking at named at the top.
 */
export function DayHeading({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-20 flex justify-center bg-grey-50 py-2">
      <span className="rounded-full bg-grey-200 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-grey-600">
        {label}
      </span>
    </div>
  );
}
