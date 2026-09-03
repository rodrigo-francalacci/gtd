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
  hrefFor,
  leavesApp,
  openHref,
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
check('a Drive id is not a project', readToken(`P${FOLDER}`), null);

// --- where they go ----------------------------------------------------------

check('a project opens on its page', hrefFor({ kind: 'project', id: PROJECT }), `/projects/${PROJECT}`);
check('an action opens in the Now pane', hrefFor({ kind: 'action', id: ACTION }), `/now?action=${ACTION}`);
check(
  'a Drive folder opens in Drive',
  hrefFor({ kind: 'drive', id: FOLDER }),
  `https://drive.google.com/drive/folders/${FOLDER}`,
);
check('only Drive leaves the app', [
  leavesApp({ kind: 'project', id: PROJECT }),
  leavesApp({ kind: 'action', id: ACTION }),
  leavesApp({ kind: 'drive', id: FOLDER }),
], [false, false, true]);

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
check(
  'a Drive folder is never rewritten into a pane',
  openHref('/box/abc?doc=d9', { kind: 'drive', id: FOLDER }),
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
        { type: 'text', text: 'broken', marks: [mark('Pnot-a-uuid')] },
        { type: 'text', text: 'plain', marks: [{ type: 'italic' }] },
      ],
    },
  ],
};

check('every token is found, however deep', tokensIn(doc), [
  { kind: 'project', id: PROJECT },
  { kind: 'action', id: ACTION },
]);
check('a document with no links yields none', tokensIn({ type: 'doc', content: [] }), []);
check('a null document yields none', tokensIn(null), []);
check('a string is not a document', tokensIn('P' + PROJECT), []);

console.log(failures === 0 ? '\nAll good.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
