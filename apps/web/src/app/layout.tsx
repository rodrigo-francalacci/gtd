import type { Metadata } from 'next';
import { Source_Sans_3 } from 'next/font/google';
import './globals.css';

/**
 * Source Sans was Evernote's UI font until they switched to Inter in January
 * 2024 — so this is the typeface of the era the three-pane layout is modelled
 * on. Self-hosted by next/font, no external request at runtime.
 */
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-sans',
});

export const metadata: Metadata = {
  title: 'GTD',
  description: 'Personal Getting Things Done system',
};

/**
 * Everything reads live rows from Neon, and the session is per-request.
 * Prerendering any of it would be wrong. Applies to all nested segments.
 */
export const dynamic = 'force-dynamic';

/**
 * Deliberately thin: html, fonts and stylesheet only.
 *
 * The three-pane shell and the session gate live in `(app)/layout.tsx`, so
 * `/signin` can render outside them. A gate in this layout would redirect the
 * sign-in page to itself.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: browser extensions inject attributes onto <html>
  // before React hydrates. Scoped to this element only.
  return (
    <html lang="en" className={sourceSans.variable} suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
