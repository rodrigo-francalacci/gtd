/**
 * The emoji worth a tap, grouped the way a personal system accumulates things.
 *
 * Not a full set. A phone's own picker has every emoji there is, sorted the way
 * Unicode sorts them, and it is a keystroke away — duplicating it here would be
 * a worse copy of something better. What this is for is the other case: the
 * dozen or so you reach for constantly, close enough to hand that the common
 * case never needs a keyboard at all.
 *
 * So the groups are about *what a row is*, not about what the glyph depicts.
 * Unicode files a car under "travel and places"; a to-do list files it under
 * the same heading as an MOT and a tank of fuel, because that is what you are
 * looking for when you scan. Every group here is a kind of errand, a kind of
 * document, or a kind of life admin.
 *
 * Ordered within a group by how often it is likely to be wanted rather than
 * alphabetically or by codepoint, because the first row of each group is what
 * you see before scrolling.
 */

export type EmojiGroup = { name: string; emoji: string[] };

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Everyday',
    emoji: [
      '🛒', '📞', '✉️', '📅', '⏰', '✅', '⭐', '🔁',
      '📌', '🔔', '💡', '❓', '⚠️', '🔥', '🎯', '📎',
    ],
  },
  {
    name: 'Money',
    emoji: [
      '💷', '💰', '🧾', '💳', '🏦', '📈', '📉', '🪙',
      '💸', '🤑', '🧮', '📊',
    ],
  },
  {
    name: 'Paperwork',
    emoji: [
      '📄', '📋', '📑', '🗂️', '🗄️', '✍️', '🖊️', '📝',
      '🔖', '📚', '🗞️', '📬', '🏷️', '🖇️', '📇', '🗃️',
    ],
  },
  {
    name: 'Home',
    emoji: [
      '🏠', '🔧', '🔨', '🪛', '🧹', '🧺', '🚿', '🛏️',
      '🪑', '🚪', '💡', '🔌', '🌡️', '🧯', '🪴', '🧴',
    ],
  },
  {
    name: 'Getting about',
    emoji: [
      '🚗', '✈️', '🚆', '🚌', '🚲', '⛽', '🅿️', '🛣️',
      '🗺️', '🧳', '🛥️', '🚕', '🛫', '🏨', '🎫', '🛂',
    ],
  },
  {
    name: 'Health',
    emoji: [
      '🩺', '💊', '🦷', '👓', '🏃', '💪', '🧘', '🥗',
      '😴', '🩹', '🧠', '❤️', '🚑', '🧬', '🫀', '🩸',
    ],
  },
  {
    name: 'Food',
    emoji: [
      '🍎', '🥛', '🍞', '🥚', '🧀', '🍝', '🍲', '☕',
      '🍺', '🍷', '🧊', '🥦', '🍫', '🧁', '🍕', '🥩',
    ],
  },
  {
    name: 'People',
    emoji: [
      '👤', '👥', '👨‍👩‍👧', '🎂', '🎁', '💐', '💌', '🤝',
      '👶', '🐕', '🐈', '☎️', '💬', '🎉', '💍', '🕯️',
    ],
  },
  {
    name: 'Work',
    emoji: [
      '💻', '🖥️', '⌨️', '🖨️', '📱', '🗓️', '📢', '🧑‍💻',
      '🏢', '🛠️', '⚙️', '🧪', '🔍', '📦', '🚀', '🧰',
    ],
  },
  {
    name: 'Making things',
    emoji: [
      '🎸', '🎹', '🥁', '🎤', '🎧', '🎬', '📷', '🎨',
      '✏️', '🧵', '🪵', '🖼️', '🎻', '🎺', '🎚️', '🎛️',
    ],
  },
  {
    name: 'Outdoors',
    emoji: [
      '🌳', '🌱', '🌦️', '☀️', '🌧️', '❄️', '⛰️', '🏖️',
      '🚶', '🎣', '⚽', '🏕️', '🌙', '🌊', '🐝', '🍂',
    ],
  },
  {
    name: 'Marks',
    emoji: [
      '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪',
      '1️⃣', '2️⃣', '3️⃣', '🔺', '🔻', '⏳', '🚧', '🛑',
    ],
  },
];

/** Flat, for anything that wants to know whether a glyph is one of ours. */
export const ALL_EMOJI = EMOJI_GROUPS.flatMap((group) => group.emoji);

/**
 * The first row of the first group: what a picker shows before you open a
 * group. Twelve, because that is two rows of six and fits the panel without
 * scrolling.
 */
export const QUICK_EMOJI = EMOJI_GROUPS[0].emoji.slice(0, 12);

/**
 * Search across every group.
 *
 * By group name rather than by emoji name, deliberately: this ships no
 * dictionary of "grinning face with sweat", which is most of the weight of an
 * emoji picker and none of its use here. Typing "money" or "home" narrows to
 * the group, which is how anyone would search a list this size.
 */
export function findGroups(query: string): EmojiGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return EMOJI_GROUPS;

  const matched = EMOJI_GROUPS.filter((group) =>
    group.name.toLowerCase().includes(needle),
  );

  return matched.length > 0 ? matched : [];
}
