import { CaptureHotkey } from '@/components/capture-hotkey';
import { FilePreviewProvider } from '@/components/file-preview';
import { SidebarNav } from '@/components/sidebar';
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
    /* Pane 1 of 3. Panes 2 and 3 come from each section's own page. The file
       preview adds a fourth on the right, but only while something is open,
       and it takes the space rather than a width of its own. */
    <FilePreviewProvider>
      {/* Renders nothing; listens for `c` so a thought can be captured from
          wherever you happen to be when it arrives. */}
      <CaptureHotkey />
      <SidebarNav
        counts={counts}
        lists={lists}
        boxes={boxes}
        theme={prefs.theme}
      />
      {/* Panes 2 and 3 live in here, so this is what has to stop growing when
          the preview opens — otherwise the pane inside it caps itself and the
          space it gave up stays trapped in this wrapper. `0 1 auto`: as wide
          as the two panes it holds, and shrinkable if the window is narrow. */}
      <main className="flex min-w-0 flex-1 group-data-[preview=open]/shell:flex-[0_1_auto]">
        {children}
      </main>
    </FilePreviewProvider>
  );
}
