/**
 * A heading inside a pane's file list.
 *
 * Not `DayHeading`: that is a centred chip built for a feed you read like a
 * chat, and it is far too loud sitting between four rows in a detail pane.
 * This is the same weight as the "Attachments" label above it, indented to the
 * rows it heads, so it reads as a subdivision of that list rather than as a
 * second list.
 */
export function GroupHeading({ label }: { label: string }) {
  return (
    <li
      className="pt-2 text-[10px] uppercase tracking-wider text-grey-400 first:pt-0"
      // A label, not a row: it names the rows under it rather than being one.
      role="presentation"
    >
      {label}
    </li>
  );
}
