import { AppsScriptPanel } from '@/components/apps-script-panel';
import {
  BackfillLinks,
  EnrichmentControls,
  SyncControls,
  VerifyLinks,
} from '@/components/connection-controls';
import { SYNC_SCOPES, hasCalendarScope, hasSyncScopes } from '@/lib/auth/google';
import { getGrant } from '@/lib/auth/token';
import { getEnrichmentStatus } from '@/lib/enrich/queue';
import { getPreferences } from '@/lib/view-mode';
import { countUnlinkedProjects, getSyncQueueStatus } from '@/lib/google/queue';

const SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/drive.file':
    'Drive — only files this app creates',
  'https://www.googleapis.com/auth/gmail.labels': 'Gmail — labels only, no messages',
  'https://www.googleapis.com/auth/calendar.readonly':
    'Calendar — read only, never written to',
};

export default async function ConnectionsPage() {
  const [grant, queue, unlinked, enrichment, prefs] = await Promise.all([
    getGrant(),
    getSyncQueueStatus(),
    countUnlinkedProjects(),
    getEnrichmentStatus(),
    getPreferences(),
  ]);
  const connected = Boolean(grant?.refreshToken);
  const syncReady = connected && hasSyncScopes(grant?.scope);
  // Granted separately, and genuinely optional: everything else works without
  // it, so it is reported as its own state rather than folded into the rest.
  const calendarReady = connected && hasCalendarScope(grant?.scope);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-paper">
      <div className="max-w-[42rem] px-8 py-7">
        <h1 className="text-xl font-semibold text-grey-900">Google</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
          Creating a project makes a Drive folder and a Gmail label, and changing
          its status moves them. Sync is one way: this app pushes, and never
          reads changes back.
        </p>

        <section className="mt-6 rounded-sm border border-grey-200 bg-grey-50 px-3 py-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Account
          </h2>
          <p className="mt-1 text-[13px] text-grey-800">
            {connected ? grant?.email : 'Not connected'}
          </p>

          <h2 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Granted access
          </h2>
          {syncReady ? (
            <>
              <ul className="mt-1 space-y-0.5">
                {SYNC_SCOPES.map((scope) => (
                  <li key={scope} className="text-[12px] text-grey-600">
                    {SCOPE_LABELS[scope] ?? scope}
                  </li>
                ))}
              </ul>

              {/*
                A grant can be alive here and dead at Google: a refresh token
                is withdrawn when it goes unused for months, when the password
                changes, or when you revoke it from your account page — and
                none of those tell the app. The scopes above still read as
                granted while every Drive call fails, so the way to consent
                again has to be permanently on offer rather than appearing
                only when the app has noticed. It is quiet because most of the
                time it isn't needed.
              */}
              <a
                href="/api/auth/signin?scopes=sync"
                className="mt-3 inline-block text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
              >
                Reconnect Google
              </a>
              <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-grey-500">
                Needed if files stop opening or the queue reports that the token
                was refused. Nothing is lost by doing it — it asks Google for the
                same two permissions again.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-[12px] text-grey-600">
                Sign-in only. Drive and Gmail have not been granted yet.
              </p>
              <a
                href="/api/auth/signin?scopes=sync"
                className="mt-2 inline-block rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper"
              >
                Connect Drive &amp; Gmail
              </a>
              <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-grey-500">
                The narrowest scopes that do the job: this app can only touch
                files it created itself, and can manage labels without reading a
                single message.
              </p>
            </>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Calendar
          </h2>
          {calendarReady ? (
            <>
              <p className="mt-1 text-[13px] text-grey-700">
                Connected, read only.
              </p>
              <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-grey-500">
                The Calendar view lists what is coming up. This app never
                creates, changes or deletes an event — those happen in Google
                Calendar, which owns them.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-grey-700">Not connected.</p>
              <a
                href="/api/auth/signin?scopes=calendar"
                className="mt-2 inline-block rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper"
              >
                Connect Calendar
              </a>
              <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-grey-500">
                Read-only, and optional — the rest of the app works without it.
                It reads which calendars you have and what is on them, so a
                second or shared calendar is not silently missing; it cannot
                write to any of them.
              </p>
            </>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Sync queue
          </h2>
          <p className="mt-1 text-[13px] text-grey-700">
            {queue.pending} waiting · {queue.done} done
            {queue.failed > 0 ? (
              <span className="text-stale"> · {queue.failed} failed</span>
            ) : null}
          </p>
          <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-grey-500">
            Drive and Gmail calls run in a background job once a day — the most
            a Hobby account allows — so saving a project never waits on Google.
            Use the button below when you don’t want to wait for it.
          </p>

          {queue.failures.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {queue.failures.map((f) => (
                <li key={f.id} className="text-[11px] text-stale">
                  after {f.attempts} attempts: {f.lastError}
                </li>
              ))}
            </ul>
          ) : null}

          <SyncControls hasFailures={queue.failed > 0} />
        </section>

        {syncReady ? (
          <section className="mt-7 border-t border-grey-150 pt-5">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
              Existing projects
            </h2>
            <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-grey-600">
              Folders and labels are made when a project is created, so anything
              you had before connecting Google has none. This creates them, in
              the container its status calls for.
            </p>
            <BackfillLinks unlinked={unlinked} />
          </section>
        ) : null}

        <section className="mt-7 border-t border-grey-150 pt-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Reading files
          </h2>
          <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-grey-600">
            Photos, PDFs and text files you attach are read in the background so
            search can reach inside them — a photographed page, a whiteboard, a
            receipt. The file itself is never altered; the text sits beside it.
          </p>
          <p className="mt-1.5 text-[13px] text-grey-700">
            {enrichment.done} read · {enrichment.pending} waiting
            {enrichment.failed > 0 ? (
              <span className="text-stale"> · {enrichment.failed} failed</span>
            ) : null}
          </p>

          {enrichment.failures.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {enrichment.failures.map((f) => (
                <li key={f.id} className="text-[11px] text-stale">
                  {f.name ?? 'a file'} — {f.lastError}
                </li>
              ))}
            </ul>
          ) : null}

          <EnrichmentControls
            configured={enrichment.configured}
            pending={enrichment.pending}
            failed={enrichment.failed}
            neverQueued={enrichment.neverQueued}
          />

          <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-grey-500">
            Voice notes aren’t transcribed yet — that needs a speech provider,
            which nothing here has. Audio you attach is kept and linked, just
            not yet searchable by what’s said in it.
          </p>
        </section>

        <section className="mt-7 border-t border-grey-150 pt-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Drift
          </h2>
          <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-grey-600">
            Checks that every live project still has the folder and label it
            thinks it has. It reports differences and changes nothing — if you
            deleted a folder in Drive, that was your decision to make.
          </p>
          <VerifyLinks />
        </section>

        <AppsScriptPanel url={prefs.appsScriptUrl} />
      </div>
    </div>
  );
}
