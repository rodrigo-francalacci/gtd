import { FilePreviewProvider } from '@/components/file-preview';
import { SidebarNav } from '@/components/sidebar';
import { requireSession } from '@/lib/auth/session';
import { getLists, getSidebarCounts } from '@/lib/queries';

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

  const [counts, lists] = await Promise.all([getSidebarCounts(), getLists()]);

  return (
    /* Pane 1 of 3. Panes 2 and 3 come from each section's own page. The file
       preview adds a fourth on the right, but only while something is open. */
    <FilePreviewProvider>
      <SidebarNav counts={counts} lists={lists} />
      <main className="flex min-w-0 flex-1">{children}</main>
    </FilePreviewProvider>
  );
}
