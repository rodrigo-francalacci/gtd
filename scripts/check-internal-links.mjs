/**
 * Checks for `lib/internal-link.ts`.
 *
 * The parser is the part worth testing, because everything downstream trusts
 * it. A token that is *nearly* right must be refused rather than half-read: a
 * project id wearing an `A` would open the action pane on an id no action has,
 * which reads as a bug in the app rather than as a mistyped letter. And the
 * walker has to find every token in a document however deeply the marks are
 * nested, or a link renders as plain text with nothing saying why.
 *
 *   node --experimental-strip-types scripts/check-internal-links.mjs
 */

import {
  focusedHref,
  hrefFor,
  openHref,
  readInternalInput,
  readToken,
  tokenFor,
  tokensIn,
} from '../apps/web/src/lib/internal-link.ts';

let failures = 0;

function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.log(`FAIL  ${what}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok    ${what}`);
  }
}

const PROJECT = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ACTION = 'aabbccdd-1122-4334-8556-778899aabbcc';
const ENTRY = 'deadbeef-0000-4111-8222-333344445555';
const FOLDER = '1AbC_dEfGhIjKlMnOpQrStUvWxYz0123';

// --- what a token is --------------------------------------------------------

check('a project token round-trips', readToken(tokenFor({ kind: 'project', id: PROJECT })), {
  kind: 'project',
  id: PROJECT,
});
check('an action token round-trips', readToken(tokenFor({ kind: 'action', id: ACTION })), {
  kind: 'action',
  id: ACTION,
});
check('a box-entry token round-trips', readToken(tokenFor({ kind: 'boxItem', id: ENTRY })), {
  kind: 'boxItem',
  id: ENTRY,
});
check('a Drive token round-trips', readToken(tokenFor({ kind: 'drive', id: FOLDER })), {
  kind: 'drive',
  id: FOLDER,
});

check('surrounding space is forgiven', readToken(`  P${PROJECT} `), {
  kind: 'project',
  id: PROJECT,
});
check('a lowercase letter is forgiven', readToken(`p${PROJECT}`), {
  kind: 'project',
  id: PROJECT,
});

// --- and what it is not -----------------------------------------------------

check('a bare uuid is refused', readToken(PROJECT), null);
check('an unknown letter is refused', readToken(`X${PROJECT}`), null);
check('a truncated uuid is refused', readToken(`P${PROJECT.slice(0, -1)}`), null);
check('a uuid with rubbish after it is refused', readToken(`P${PROJECT} and`), null);
check('an empty token is refused', readToken('P'), null);
check('nothing is refused', readToken(''), null);
/*
 * The one that matters most. A Drive id has no fixed shape, so the pattern has
 * to be loose — and a loose pattern would happily accept a uuid, quietly
 * turning a mistyped project link into a Drive folder that does not exist.
 * Hyphens are what tell them apart.
 */
check('a uuid is not a Drive folder', readToken(`D${PROJECT}`), null);
check('a Drive id is not a box entry', readToken(`B${FOLDER}`), null);
check('a Drive id is not a project', readToken(`P${FOLDER}`), null);

// --- what a person is allowed to paste --------------------------------------

/*
 * `readToken` is strict because it reads *data* — the mark's attribute and the
 * `?open=` parameter. `readInternalInput` is the other end, where somebody is
 * pasting whatever they have to hand, and being strict there is just being
 * unhelpful: a real Drive folder id was refused because it had no `D` in front
 * of it, which is not something anybody would think to add.
 */
check('a token still reads', readInternalInput(`P${PROJECT}`), { kind: 'project', id: PROJECT });
check('a bare Drive id is taken as one', readInternalInput(FOLDER), { kind: 'drive', id: FOLDER });
check(
  'a Drive folder link',
  readInternalInput(`https://drive.google.com/drive/folders/${FOLDER}`),
  { kind: 'drive', id: FOLDER },
);
check(
  'a Drive link with an account in the path',
  readInternalInput(`https://drive.google.com/drive/u/0/folders/${FOLDER}?usp=sharing`),
  { kind: 'drive', id: FOLDER },
);
check(
  'a Drive file link',
  readInternalInput(`https://drive.google.com/file/d/${FOLDER}/view`),
  { kind: 'drive', id: FOLDER },
);
check(
  'the older open?id= form',
  readInternalInput(`https://drive.google.com/open?id=${FOLDER}`),
  { kind: 'drive', id: FOLDER },
);
check('surrounding space is forgiven here too', readInternalInput(`  ${FOLDER}  `), {
  kind: 'drive',
  id: FOLDER,
});

/*
 * A bare uuid stays refused, and this is the one that must never soften: it
 * cannot say whether it names a project or an action, and guessing would open a
 * pane on an id the other table has never heard of.
 */
check('a bare uuid is still refused', readInternalInput(PROJECT), null);
check('an unrelated URL is refused', readInternalInput('https://example.com/x/folders/abcdefghij'), null);
check('a sentence is refused', readInternalInput('the quote I got in March'), null);
check('something too short to be a Drive id', readInternalInput('abc'), null);
check('nothing is refused', readInternalInput(''), null);

// --- where they go ----------------------------------------------------------

check('a project opens on its page', hrefFor({ kind: 'project', id: PROJECT }), `/projects/${PROJECT}`);
check('an action opens in the Now pane', hrefFor({ kind: 'action', id: ACTION }), `/now?action=${ACTION}`);
/*
 * Which box an entry is in is looked up when the link is followed, never
 * stored — an entry can be moved between boxes, and a token carrying the box
 * would be a copy of a fact that changes.
 */
check('a box entry is found rather than addressed', hrefFor({ kind: 'boxItem', id: ENTRY }), `/box/find/${ENTRY}`);
check(
  'a Drive folder opens in Drive',
  hrefFor({ kind: 'drive', id: FOLDER }),
  `https://drive.google.com/drive/folders/${FOLDER}`,
);
/*
 * Whether a link leaves the app is a property of the *address*, not of the
 * kind — the page decides, and the renderers read the answer off the href it
 * gave them. `hrefFor` is the no-pane fallback and is the only place a Drive
 * folder is sent outside.
 */
check('only the Drive fallback leaves the app', [
  hrefFor({ kind: 'project', id: PROJECT }).startsWith('/'),
  hrefFor({ kind: 'action', id: ACTION }).startsWith('/'),
  hrefFor({ kind: 'boxItem', id: ENTRY }).startsWith('/'),
  hrefFor({ kind: 'drive', id: FOLDER }).startsWith('/'),
], [true, true, true, false]);

/*
 * Following a link must not cost you the filters that found the entry — that is
 * the whole reason the box builds its own address rather than using `hrefFor`.
 */
check(
  'opening in a pane keeps every other parameter',
  openHref('/box/abc?tag=t1&tag=t2&doc=d9', { kind: 'project', id: PROJECT }),
  `/box/abc?tag=t1&tag=t2&doc=d9&open=P${PROJECT}`,
);
check(
  'opening replaces a previous open rather than stacking',
  openHref(`/box/abc?doc=d9&open=A${ACTION}`, { kind: 'project', id: PROJECT }),
  `/box/abc?doc=d9&open=P${PROJECT}`,
);
/*
 * A Drive folder opens in the pane too, now that a script walks the linked
 * folders and there is something to draw. It did not at first, and the reason
 * it changed is worth keeping: the app still cannot list that folder — it is
 * shown a snapshot, with its date on it, and every row in it links out.
 */
check(
  'a Drive folder opens in the pane as well',
  openHref('/box/abc?doc=d9', { kind: 'drive', id: FOLDER }),
  `/box/abc?doc=d9&open=D${FOLDER}`,
);

/*
 * Following a link from the focus view must not drop you back into the panes.
 * There is no pane three there — the window is one thing — so the equivalent is
 * the target's own focus view.
 */
check('a project keeps you full screen', focusedHref({ kind: 'project', id: PROJECT }), `/projects/${PROJECT}?focus=1`);
check('an action keeps you full screen', focusedHref({ kind: 'action', id: ACTION }), `/now?action=${ACTION}&focus=1`);
check('a box entry carries the flag through the lookup', focusedHref({ kind: 'boxItem', id: ENTRY }), `/box/find/${ENTRY}?focus=1`);
check(
  'a Drive folder still leaves, at any size',
  focusedHref({ kind: 'drive', id: FOLDER }),
  `https://drive.google.com/drive/folders/${FOLDER}`,
);

// --- finding them in a document --------------------------------------------

const mark = (target) => ({ type: 'internalLink', attrs: { target } });

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'see ', marks: [] },
        { type: 'text', text: 'the kitchen', marks: [mark(`P${PROJECT}`)] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                // Nested three deep, and wearing a second mark: a link that has
                // been bolded is still a link.
                {
                  type: 'text',
                  text: 'chase it',
                  marks: [{ type: 'bold' }, mark(`A${ACTION}`)],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        // Refused on the way out rather than reported as a target that will
        // never resolve.
        { type: 'text', text: 'the receipt in Work', marks: [mark(`B${ENTRY}`)] },
        { type: 'text', text: 'broken', marks: [mark('Pnot-a-uuid')] },
        { type: 'text', text: 'plain', marks: [{ type: 'italic' }] },
      ],
    },
  ],
};

check('every token is found, however deep', tokensIn(doc), [
  { kind: 'project', id: PROJECT },
  { kind: 'action', id: ACTION },
  { kind: 'boxItem', id: ENTRY },
]);
check('a document with no links yields none', tokensIn({ type: 'doc', content: [] }), []);
check('a null document yields none', tokensIn(null), []);
check('a string is not a document', tokensIn('P' + PROJECT), []);

console.log(failures === 0 ? '\nAll good.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
