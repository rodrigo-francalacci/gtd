import { redirect } from 'next/navigation';

/**
 * The brief is explicit: the default view is "what can I do now", not a
 * project list.
 */
export default function Home() {
  redirect('/now');
}
