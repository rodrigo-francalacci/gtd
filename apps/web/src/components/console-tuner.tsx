'use client';

import { useEffect, useState } from 'react';

/**
 * TEMPORARY — a tuning panel for the two console themes.
 *
 * Not a feature. It exists so the scanlines and the tracking can be set by eye
 * against the real app rather than guessed at in a stylesheet, and it is to be
 * deleted once the numbers are chosen and written into `globals.css`. Nothing
 * else imports it and it renders nothing outside `sci` and `amber`.
 *
 * It writes CSS custom properties straight onto `<html>`, which is what makes
 * it live: every rule that reads one was written with the current value as its
 * fallback, so the app looks exactly as it did until a slider moves.
 *
 * Values are kept in `localStorage` so walking around the app to see them
 * against a list, a note and a preview does not reset the panel — the same
 * argument the phone's draft makes, and just as temporary.
 */

type Knob = {
  key: string;
  /** The custom property it drives. */
  prop: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** What the stylesheet does when nothing is set. */
  fallback: number;
  unit: string;
  hint: string;
};

const KNOBS: Knob[] = [
  {
    key: 'ink',
    prop: '--console-line-ink',
    label: 'Line darkness',
    min: 0,
    max: 0.8,
    step: 0.01,
    fallback: 0.34,
    unit: '',
    hint: 'How black each scanline is',
  },
  {
    key: 'thick',
    prop: '--console-line-thick',
    label: 'Line thickness',
    min: 0.5,
    max: 4,
    step: 0.5,
    fallback: 1,
    unit: 'px',
    hint: 'How tall one line is',
  },
  {
    key: 'gap',
    prop: '--console-line-gap',
    label: 'Line spacing',
    min: 2,
    max: 10,
    step: 1,
    fallback: 3,
    unit: 'px',
    hint: 'Distance from one line to the next — bigger is fewer',
  },
  {
    key: 'letter',
    prop: '--console-letter',
    label: 'Letter spacing',
    min: -0.06,
    max: 0.12,
    step: 0.005,
    fallback: 0,
    unit: 'em',
    hint: 'Body text',
  },
  {
    key: 'word',
    prop: '--console-word',
    label: 'Word spacing',
    min: -0.3,
    max: 0.4,
    step: 0.01,
    fallback: 0,
    unit: 'em',
    hint: 'Body text',
  },
  {
    key: 'label',
    prop: '--console-label',
    label: 'Label tracking',
    min: 0,
    max: 0.4,
    step: 0.005,
    fallback: 0.16,
    unit: 'em',
    hint: 'The small caps headings only',
  },
];

const STORE = 'gtd-console-tuner';

export function ConsoleTuner() {
  const [theme, setTheme] = useState<string | null>(null);
  /*
   * Read once, in the initialiser rather than in an effect.
   *
   * Setting state from inside an effect is what the compiler refuses, and it
   * is right to: this is not synchronising with anything that changes, it is a
   * value that exists before the first render. Safe against a hydration
   * mismatch because the panel renders `null` until the theme is known, which
   * is itself an effect — so the first client render agrees with the server's
   * nothing whatever is in storage.
   */
  const [values, setValues] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  });
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  /* Which theme is on, watched rather than read once: the switcher changes the
     attribute without a navigation, so this has to appear and disappear with it. */
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme ?? null);
    read();

    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => watch.disconnect();
  }, []);

  const consoleTheme = theme === 'sci' || theme === 'amber';

  /* Written to `<html>`, and removed again when the theme is not a console one
     — otherwise a value set here would follow you into paper or riso. */
  useEffect(() => {
    const root = document.documentElement;

    for (const knob of KNOBS) {
      const value = values[knob.key];
      if (!consoleTheme || value === undefined) {
        root.style.removeProperty(knob.prop);
      } else {
        root.style.setProperty(knob.prop, `${value}${knob.unit}`);
      }
    }
  }, [values, consoleTheme]);

  const set = (key: string, value: number) => {
    const next = { ...values, [key]: value };
    setValues(next);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* Nothing to do; the panel still works for this session. */
    }
  };

  const reset = () => {
    setValues({});
    try {
      window.localStorage.removeItem(STORE);
    } catch {
      /* As above. */
    }
  };

  const valueOf = (knob: Knob) => values[knob.key] ?? knob.fallback;

  /** Exactly what to tell Claude, in the shape the stylesheet wants. */
  const summary = KNOBS.map((knob) => `${knob.prop}: ${valueOf(knob)}${knob.unit};`).join('\n');

  if (!consoleTheme) return null;

  return (
    <div
      /* Above the scanline overlay, which is 9999 — this is the one thing in
         the app that has to sit on top of the costume. */
      className="fixed bottom-3 right-3 z-[10001] w-64 rounded-sm border border-grey-300 bg-paper p-2 text-[11px] text-grey-700 shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-2">
        <strong className="text-[10px] uppercase tracking-wider text-grey-500">
          Console tuner · temporary
        </strong>
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="shrink-0 text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          {open ? 'hide' : 'show'}
        </button>
      </div>

      {open ? (
        <>
          {KNOBS.map((knob) => (
            <label key={knob.key} className="mt-2 block">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate" title={knob.hint}>
                  {knob.label}
                </span>
                <span className="shrink-0 tabular-nums text-grey-500">
                  {valueOf(knob)}
                  {knob.unit}
                </span>
              </span>
              <input
                type="range"
                min={knob.min}
                max={knob.max}
                step={knob.step}
                value={valueOf(knob)}
                onChange={(event) => set(knob.key, Number(event.target.value))}
                className="mt-0.5 w-full"
              />
            </label>
          ))}

          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-grey-200 pt-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(summary);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              className="text-grey-600 underline underline-offset-2 hover:text-grey-900"
            >
              {copied ? 'copied' : 'copy the six values'}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              reset
            </button>
          </div>

          {/* Readable without the clipboard too, in case you would rather just
              tell me the numbers. */}
          <pre className="mt-1.5 whitespace-pre-wrap break-words text-[10px] leading-snug text-grey-500">
            {summary}
          </pre>
        </>
      ) : null}
    </div>
  );
}
