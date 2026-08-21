import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import { getBoxes } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * The boxes, for a picker outside the app.
 *
 * Currently the extension's Box tab, which has to let you choose where a thing
 * is filed and cannot read the database. Names and ids only — no counts, no
 * instructions, no tag vocabulary: a picker needs to list them and nothing
 * else, and the rest is the app's business.
 *
 * `apiSession`, not `requireSession`: the latter redirects to `/signin`, which
 * a `fetch` follows, so the caller gets 200 and a page of HTML where it
 * expected JSON and "signed out" becomes indistinguishable from "the request
 * failed". Pages redirect; routes return 401.
 */
export async function GET() {
  const unauthorised = await apiSession();
  if (unauthorised) return unauthorised;

  const boxes = await getBoxes();

  return NextResponse.json({
    boxes: boxes.map((box) => ({
      id: box.id,
      name: box.name,
      isDefault: box.isDefault,
    })),
  });
}
