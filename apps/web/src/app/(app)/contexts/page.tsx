import { ContextManager } from '@/components/context-manager';
import { getContextsWithUsage } from '@/lib/queries';

/**
 * Contexts are freeform and user-created, per the brief — this is where that
 * becomes true rather than theoretical. Nothing here is a fixed enum; the
 * dimensions are, but their contents are yours.
 */
export default async function ContextsPage() {
  const contexts = await getContextsWithUsage();

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-paper">
      <div className="max-w-[42rem] px-8 py-7">
        <h1 className="text-xl font-semibold text-grey-900">Contexts</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
          The four dimensions of &ldquo;what can I do now&rdquo;. An action can
          carry one from each, and the filter bar only shows dimensions that
          have something in them — so leave any you don&apos;t use empty.
        </p>

        <div className="mt-6">
          <ContextManager contexts={contexts} />
        </div>
      </div>
    </div>
  );
}
