'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAppsScriptUrl } from '@/lib/actions';

/**
 * A way to the bridges, from the app they feed.
 *
 * Two scripts do work this app cannot: the scanner sweep, because `drive.file`
 * cannot see a folder the app did not write to, and the Gmail bridge, because
 * reading a message body needs a restricted scope. Both run on time triggers,
 * and a trigger runs when it runs — which is fine until you have just scanned
 * something, or labelled a message, and would like to watch it arrive.
 *
 * The panel is a page of buttons deployed from the same Apps Script project.
 * This is the link to it, and the field for saying where it is.
 *
 * **A setting rather than a constant.** A deployment URL names one person's
 * script in one person's Google account, and this repository is public. It is
 * also the sort of thing that changes: a *new deployment* rather than a new
 * version of an existing one gives a different address, and a setting can be
 * corrected on the page it is used from.
 *
 * Opened in a tab rather than embedded. The page can be framed — it sets
 * `ALLOWALL` — but a web app on another origin has its own sign-in behaviour,
 * and a Google login redirect inside an iframe is a blank rectangle with
 * nothing in it to click.
 */
export function AppsScriptPanel({ url }: { url: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);

    startTransition(async () => {
      const result = await setAppsScriptUrl(text);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setEditing(false);
      router.refresh();
    });
  };

  return (
    <section className="mt-8 border-t border-grey-150 pt-5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        Bridges
      </h2>

      <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
        The scanner sweep and the Gmail bridge run in Apps Script, because they
        need access this app deliberately does not hold. They run on a trigger;
        the panel is how you run one now.
      </p>

      {url && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm bg-grey-800 px-3 py-1.5 text-[12px] text-paper hover:bg-grey-900"
          >
            Open the panel ↗
          </a>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Change the address
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  save();
                }
                if (event.key === 'Escape' && url) {
                  setText(url);
                  setEditing(false);
                }
              }}
              placeholder="https://script.google.com/…/exec"
              aria-label="Apps Script panel address"
              /* 16px, or iOS Safari zooms the page in when it takes focus. */
              className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-2 py-1.5 text-[16px] text-grey-800 placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[12px]"
            />
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="shrink-0 rounded-sm bg-grey-800 px-3 py-1.5 text-[12px] text-paper disabled:opacity-40"
            >
              Save
            </button>
            {url ? (
              <button
                type="button"
                onClick={() => {
                  setText(url);
                  setEditing(false);
                }}
                className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2"
              >
                Cancel
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="text-[12px] text-stale">{error}</p>
          ) : (
            /* The steps, because they are not guessable and getting them wrong
               produces a URL that looks right and serves an old version. */
            <p className="max-w-prose text-[12px] leading-relaxed text-grey-500">
              In Apps Script: add <code>scripts/gtd-panel.gs</code> as a file, then
              Deploy → New deployment → Web app, executing as <em>me</em> with access
              for <em>only myself</em>. Paste the <code>/exec</code> URL here. After
              editing any of the three scripts, redeploy with Manage deployments →
              edit → New version, or the panel keeps serving the old one.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
