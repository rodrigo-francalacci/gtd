'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The search field, in the same corner old Evernote kept "Pesquisar notas".
 *
 * Submits rather than searching as you type: full-text over four tables is a
 * real query, and a request per keystroke would be wasteful for a box you use
 * a few times a day. Cmd/Ctrl+K focuses it.
 */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState(params.get('q') ?? '');

  // Keep the box in step with the URL when navigating between searches.
  useEffect(() => {
    setTerm(params.get('q') ?? '');
  }, [params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = term.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
      className="border-b border-grey-200 px-3 py-2"
    >
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search…"
        aria-label="Search"
        className="w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] text-grey-800 placeholder:text-grey-500 focus:border-grey-500 focus:outline-none"
      />
    </form>
  );
}
