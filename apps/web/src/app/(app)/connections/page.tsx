import {
  BackfillLinks,
  EnrichmentControls,
  SyncControls,
  VerifyLinks,
} from '@/components/connection-controls';
import { SYNC_SCOPES, hasSyncScopes } from '@/lib/auth/google';
import { getGrant } from '@/lib/auth/token';
import { getEnrichmentStatus } from '@/lib/enrich/queue';
import { countUnlinkedProjects, getSyncQueueStatus } from '@/lib/google/queue';

const SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/drive.file':
    'Drive — only files this app creates',
  'https://www.googleapis.com/auth/gmail.labels': 'Gmail — labels only, no messages',
};

export default async function ConnectionsPage() {
  const [grant, queue, unlinked, enrichment] = await Promise.all([
    getGrant(),
    getSyncQueueStatus(),
    countUnlinkedProjects(),
    getEnrichmentStatus(),
  ]);
  const connected = Boolean(grant?.refreshToken);
  const syncReady = connected && hasSyncScopes(grant?.scope);

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
            <ul className="mt-1 space-y-0.5">
              {SYNC_SCOPES.map((scope) => (
                <li key={scope} className="text-[12px] text-grey-600">
                  {SCOPE_LABELS[scope] ?? scope}
                </li>
              ))}
            </ul>
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
            Sync queue
          </h2>
          <p className="mt-1 text-[13px] text-grey-700">
            {queue.pending} waiting · {queue.done} done
            {queue.failed > 0 ? (
              <span className="text-stale"> · {queue.failed} failed</span>
            ) : null}
          </p>
          <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-grey-500">
            Drive and Gmail calls run in a background job every ten minutes, so
            saving a project never waits on Google.
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
      </div>
    </div>
  );
}
