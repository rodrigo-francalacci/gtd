/**
 * How many chips each tag category may show before it has to fold.
 *
 * A box's vocabulary grows without limit and the filter bar does not: document
 * types stay at half a dozen forever, but locations become every town you have
 * bought fuel in and vendors become every shop you have ever kept a receipt
 * from. Left alone, the bar ends up taller than the list it is filtering, which
 * is the one thing a filter must never be.
 *
 * A flat cap per category is the obvious answer and the wrong one: it truncates
 * a category of four just as readily as a category of four hundred, so the
 * short rows lose tags for nothing while the long ones stay long. This shares a
 * budget instead, and hands back what the small categories do not need.
 *
 * The rule is: everyone gets an equal share; anyone who wants less than their
 * share takes what they want and the remainder is re-shared among the rest.
 * Repeat until nobody is under. With a budget of fifteen and categories of
 * 4, 60 and 200 that gives 4, 5 and 6 — the small one intact, the two large
 * ones folded — rather than 5, 5, 5 with a tag needlessly hidden.
 */
export function allotTags(sizes: number[], budget: number): number[] {
  const allowed = sizes.map(() => 0);
  let pending = sizes.map((_, index) => index).filter((index) => sizes[index] > 0);
  let left = budget;

  // Hand back the surplus, repeatedly. Each pass settles every category that
  // wants less than an equal share of what is left, which raises the share for
  // everyone still waiting; it stops when nobody is under.
  while (pending.length > 0 && left > 0) {
    const share = Math.floor(left / pending.length);
    if (share < 1) break;

    const settled = pending.filter((index) => sizes[index] <= share);
    if (settled.length === 0) break;

    for (const index of settled) {
      allowed[index] = sizes[index];
      left -= sizes[index];
    }

    pending = pending.filter((index) => !settled.includes(index));
  }

  /*
   * What is left goes round the rest evenly, the odd chip to the first few.
   *
   * Floor and a remainder rather than a ceiling for everyone, which was the
   * first attempt and quietly spent more than the budget — three categories
   * each rounded up is three chips over, and the number that was supposed to
   * bound the bar bounded nothing.
   */
  const each = pending.length > 0 ? Math.floor(left / pending.length) : 0;
  let extra = pending.length > 0 ? left % pending.length : 0;

  for (const index of pending) {
    allowed[index] = Math.min(sizes[index], each + (extra > 0 ? 1 : 0));
    if (extra > 0) extra--;
  }

  /*
   * Never fold a single tag away.
   *
   * A "+1" is a worse thing to show than the tag it is hiding: it costs the
   * same width, says less, and asks for a click to reveal something that was
   * already going to fit. Going one over budget per category is the cheaper
   * mistake, and it only happens where the division landed unluckily.
   */
  return allowed.map((n, index) => (n === sizes[index] - 1 ? sizes[index] : n));
}

/**
 * The whole bar's budget.
 *
 * Fifteen is what you can read without scanning — about two lines of chips in a
 * pane at its usual width, which is the point at which a filter stops being
 * something you glance at and becomes something you search.
 */
export const TAG_BUDGET = 15;
