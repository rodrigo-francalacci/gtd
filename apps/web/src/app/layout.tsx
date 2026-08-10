import type { Metadata } from 'next';
import { SidebarNav } from '@/components/sidebar';
import { getLists, getSidebarCounts } from '@/lib/queries';
import './globals.css';

export const metadata: Metadata = {
  title: 'GTD',
  description: 'Personal Getting Things Done system',
};

/**
 * Every pane reads live rows from Neon, and the sidebar counts sit in this
 * layout. Prerendering any of it would bake data in at build time. Applies to
 * all nested segments.
 */
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [counts, lists] = await Promise.all([getSidebarCounts(), getLists()]);

  // suppressHydrationWarning: browser extensions inject attributes onto <html>
  // before React hydrates. Scoped to this element only.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* Pane 1 of 3. Panes 2 and 3 come from each section's own layout. */}
        <div className="flex h-screen w-screen">
          <SidebarNav counts={counts} lists={lists} />
          <main className="flex min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
