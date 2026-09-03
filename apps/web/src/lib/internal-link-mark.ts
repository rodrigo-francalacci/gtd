import { Mark, mergeAttributes } from '@tiptap/core';
import { readToken, tokenFor, type InternalTarget } from './internal-link';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    internalLink: {
      setInternalLink: (target: InternalTarget) => ReturnType;
      unsetInternalLink: () => ReturnType;
    };
  }
}

/**
 * A link to a project, an action or a Drive folder.
 *
 * Its own mark rather than a `link` with a funny href, and the reason is what
 * the link extension does when it is not looking: it autolinks, it validates
 * protocols, and it renders an anchor that a browser will try to navigate. An
 * internal target is none of those things — it is a token this app resolves —
 * so giving it to the link extension would mean fighting every one of those
 * behaviours to get a span back.
 *
 * The token is stored and nothing else. What a project is *called* is not
 * copied in: rename it and every note pointing at it is still right, which is
 * the same reason `box_item_links` stores an id and the reason a renamed box
 * keeps its citations. The visible text stays whatever you selected, because
 * you chose it — a note saying "the quote I got in March" should not silently
 * become the project's title.
 */
export const InternalLinkMark = Mark.create({
  name: 'internalLink',
  inclusive: false,

  addAttributes() {
    return {
      target: {
        default: null as string | null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-internal');
          return raw && readToken(raw) ? raw : null;
        },
        renderHTML: (attributes) => {
          const raw = attributes.target;
          if (typeof raw !== 'string' || !readToken(raw)) return {};

          return {
            'data-internal': raw,
            // Deliberately not an href. Nothing here should be navigable by the
            // browser on its own: the app resolves the token and decides where
            // pane three goes.
            class: 'internal-link',
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-internal]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setInternalLink:
        (target) =>
        ({ commands }) =>
          commands.setMark(this.name, { target: tokenFor(target) }),
      unsetInternalLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
