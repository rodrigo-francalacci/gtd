import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * The four inks a note can be written in.
 *
 * Deliberately few. Every other colour in this app is semantic — `waiting`,
 * `stale`, `selected`, and the journal violet each mean exactly one thing —
 * and these are the exception that means whatever you meant by them. Four is
 * the number that stays useful: a palette you have to choose carefully from is
 * one you stop using, and a note in eleven colours is harder to read than a
 * note in none.
 */
export const NOTE_COLOURS = ['blue', 'green', 'amber', 'red'] as const;

export type NoteColour = (typeof NOTE_COLOURS)[number];

export function isNoteColour(value: unknown): value is NoteColour {
  return NOTE_COLOURS.includes(value as NoteColour);
}

/** What a mark of this colour should be painted with, in the current theme. */
export function colourVar(colour: NoteColour): string {
  return `var(--note-${colour})`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteColour: {
      setNoteColour: (colour: NoteColour) => ReturnType;
      unsetNoteColour: () => ReturnType;
    };
  }
}

/**
 * Colour as a *name*, never as a value.
 *
 * The obvious build stores `#1d4ed8` on the mark, and it is wrong here for a
 * reason the theme switcher makes unavoidable: blue on white and blue on a
 * black phosphor screen cannot be the same blue and still be legible. A stored
 * hex is a decision made once, in whichever theme happened to be on at the
 * time, and imposed on every other one for ever — including parchment, where a
 * bright screen blue is nearly invisible.
 *
 * So the document records "blue" and the stylesheet decides what blue is. Six
 * themes each define the four tokens; no note knows which it is being read in.
 *
 * The name is validated on the way in *and* on the way out. Anything else —
 * a pasted `style` attribute, an older document, a hand-edited payload — is
 * dropped rather than rendered, so a note can never carry an arbitrary colour
 * and no `style` string from outside is ever trusted.
 */
export const NoteColourMark = Mark.create({
  name: 'noteColour',

  addAttributes() {
    return {
      colour: {
        default: null as NoteColour | null,
        parseHTML: (element) => {
          const named = element.getAttribute('data-colour');
          return isNoteColour(named) ? named : null;
        },
        renderHTML: (attributes) => {
          const colour = attributes.colour;
          if (!isNoteColour(colour)) return {};

          return {
            'data-colour': colour,
            style: `color: ${colourVar(colour)}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-colour]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setNoteColour:
        (colour) =>
        ({ commands }) =>
          isNoteColour(colour)
            ? commands.setMark(this.name, { colour })
            : false,
      unsetNoteColour:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
