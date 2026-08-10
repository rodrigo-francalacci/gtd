import { redirect } from 'next/navigation';
import { isConfigured } from '@/lib/auth/google';
import { getSession } from '@/lib/auth/session';

const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  forbidden: 'That Google account is not the owner of this system.',
  state: 'The sign-in request expired or did not match. Please try again.',
  missing: 'The sign-in request was incomplete. Please try again.',
  noemail: 'Google did not return a verified email address.',
  exchange: 'Could not complete sign-in with Google. Please try again.',
};

export default async function SignInPage(props: PageProps<'/signin'>) {
  const searchParams = await props.searchParams;
  const error = typeof searchParams.error === 'string' ? searchParams.error : null;

  if (await getSession()) redirect('/now');

  const configured = isConfigured();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-paper">
      <div className="w-full max-w-sm px-8">
        <h1 className="text-xl font-semibold text-grey-900">GTD</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-grey-600">
          A personal system for one person. Sign in with the Google account that
          owns it.
        </p>

        {error ? (
          <p className="mt-4 rounded-sm bg-stale-bg px-3 py-2 text-[12px] text-stale">
            {MESSAGES[error] ?? 'Sign-in failed. Please try again.'}
          </p>
        ) : null}

        {configured ? (
          <a
            href="/api/auth/signin"
            className="mt-5 inline-block rounded-sm bg-grey-800 px-3 py-2 text-[13px] text-paper"
          >
            Continue with Google
          </a>
        ) : (
          <p className="mt-5 rounded-sm border border-grey-300 bg-grey-50 px-3 py-2.5 text-[12px] leading-relaxed text-grey-600">
            Google sign-in is not configured on this deployment. Set{' '}
            <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{' '}
            <code>AUTH_ALLOWED_EMAIL</code>, then reload.
          </p>
        )}
      </div>
    </div>
  );
}
