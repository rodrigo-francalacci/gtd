import { AppShell } from '@/components/app-shell';
import { boxLabelName } from '@/lib/google/boxes';
import { CaptureHotkey } from '@/components/capture-hotkey';
import { FilePreviewProvider } from '@/components/file-preview';
import { SidebarNav } from '@/components/sidebar';
import { SidebarSlotProvider } from '@/components/sidebar-slot';
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
    /*
      The note heights ride down as CSS variables rather than as props.

      Every editor that wants one is several route segments below this, behind
      a page and a detail pane, and threading a number through all of them to
      size a textarea is more plumbing than the setting is worth. A variable on
      a wrapper is inherited by all of them, is server-rendered so the editor is
      already the right size on first paint, and is the same trick the theme
      uses one layout up.
    */
    <div
      style={
        {
          ...(prefs.noteHeight ? { '--note-height': `${prefs.noteHeight}px` } : {}),
          ...(prefs.boxNoteHeight
            ? { '--box-note-height': `${prefs.boxNoteHeight}px` }
            : {}),
        } as React.CSSProperties
      }
      data-note-heights
      className="contents"
    >
    <FilePreviewProvider>
      <SidebarSlotProvider>
        {/* Both render nothing. One listens for `c` so a thought can be captured
            from wherever you are; the other counts what gets opened. */}
        <CaptureHotkey />
        <UsageTracker />

        <AppShell
          sidebar={
            <SidebarNav
              counts={counts}
              lists={lists}
              boxes={boxes.map((box) => ({
                id: box.id,
                name: box.name,
                pendingCount: box.pendingCount,
                /*
                 * The label's *name* rather than its id, because the only
                 * useful thing to say once it exists is what to type into
                 * Gmail's label menu. Derived from the box's name by the same
                 * rule that made it, so a renamed box shows where its mail
                 * will go once the label catches up.
                 */
                gmailLabelName: box.gmailLabelId ? boxLabelName(box.name) : null,
              }))}
              theme={prefs.theme}
              appsScriptUrl={prefs.appsScriptUrl}
            />
          }
        >
          {children}
        </AppShell>
      </SidebarSlotProvider>
    </FilePreviewProvider>
    </div>
  );
}
