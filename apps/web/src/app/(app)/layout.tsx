import { AppShell } from '@/components/app-shell';
import { CaptureHotkey } from '@/components/capture-hotkey';
import { FilePreviewProvider } from '@/components/file-preview';
import { SidebarNav } from '@/components/sidebar';
import { UsageTracker } from '@/components/usage-tracker';
import { requireSession } from '@/lib/auth/session';
import { getBoxes, getLists, getSidebarCounts } from '@/lib/queries';
import { getPreferences } from '@/lib/view-mode';

/**
 * The signed-in shell.
 *
 * `requireSession` runs before any query, so an anonymous request is
 * redirected to /signin without a single row being read. This covers reads;
 * writes are gated separately inside each Server Action, because those are
 * plain POST endpoints that never pass through a layout.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  const [counts, lists, boxes, prefs] = await Promise.all([
    getSidebarCounts(),
    getLists(),
    getBoxes(),
    getPreferences(),
  ]);

  return (
    /* Preview state only — `AppShell` decides where the pane goes, because
       that differs between the two layouts and nothing else does. */
    <FilePreviewProvider>
      {/* Both render nothing. One listens for `c` so a thought can be captured
          from wherever you are; the other counts what gets opened. */}
      <CaptureHotkey />
      <UsageTracker />

      <AppShell
        sidebar={
          <SidebarNav
            counts={counts}
            lists={lists}
            boxes={boxes}
            theme={prefs.theme}
          />
        }
      >
        {children}
      </AppShell>
    </FilePreviewProvider>
  );
}
