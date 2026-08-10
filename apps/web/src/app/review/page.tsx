import Link from 'next/link';
import {
  AddNextAction,
  ChaseButton,
  ReviewedTick,
  StartReviewButton,
  StepNav,
} from '@/components/review-controls';
import { getInboxItems } from '@/lib/queries';
import { daysSince, isStale } from '@/lib/queries.shared';
import {
  REVIEW_STEPS,
  STEP_BLURBS,
  STEP_LABELS,
  clampStep,
  getActiveReview,
  getLastCompletedReview,
  getProjectsForReview,
  getReviewProgress,
  getStalledForReview,
  getWaitingForReview,
  type ReviewStep,
  type StepProgress,
} from '@/lib/review';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * The weekly review is a mode, not a place to browse — so it takes the whole
 * pane rather than the usual list/detail split, and the only navigation is
 * forwards and backwards through the steps.
 */
export default async function ReviewPage(props: PageProps<'/review'>) {
  const searchParams = await props.searchParams;
  const review = await getActiveReview();

  if (!review) {
    const last = await getLastCompletedReview();
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-grey-900">Weekly review</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
          A guided pass through the system: empty the inbox, look at every
          project, unstick whatever stalled, chase what you are waiting on, and
          reconsider standby. Each step stays shut until the work behind it is
          actually done.
        </p>
        <p className="mt-3 text-[12px] text-grey-500">
          {last
            ? `Last completed ${dateFormat.format(last)}.`
            : 'You have not completed one yet.'}
        </p>
        <div className="mt-5">
          <StartReviewButton />
        </div>
      </Shell>
    );
  }

  const progress = await getReviewProgress(review.startedAt);

  // A step reached by URL or by a stale button is clamped back to the first
  // one with outstanding work — that is the "won't let you skip" rule.
  const requested = (
    typeof searchParams.step === 'string' ? searchParams.step : review.step
  ) as ReviewStep;
  const step = clampStep(requested, progress);

  const index = REVIEW_STEPS.indexOf(step as Exclude<ReviewStep, 'done'>);
  const current = progress.find((p) => p.step === step);
  const nextStep = index >= 0 && index < REVIEW_STEPS.length - 1 ? REVIEW_STEPS[index + 1] : null;
  const previousStep = index > 0 ? REVIEW_STEPS[index - 1] : null;

  if (step === 'done' || index === -1) {
    return (
      <Shell>
        <Rail progress={progress} step={step} />
        <h1 className="mt-4 text-xl font-semibold text-grey-900">Everything is clear</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
          Inbox empty, every project looked at, nothing stalled, waiting-for
          chased, standby reconsidered.
        </p>
        <StepNav
          reviewId={review.id}
          step={step}
          nextStep={null}
          previousStep="standby"
          canAdvance
          blockedReason={null}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Rail progress={progress} step={step} />

      <h1 className="mt-4 text-xl font-semibold text-grey-900">{STEP_LABELS[step]}</h1>
      <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-grey-600">
        {STEP_BLURBS[step]}
      </p>

      <div className="mt-5">
        {step === 'inbox' ? <InboxStep /> : null}
        {step === 'projects' ? (
          <ProjectsStep startedAt={review.startedAt} statuses={['active']} />
        ) : null}
        {step === 'stalled' ? <StalledStep /> : null}
        {step === 'waiting' ? <WaitingStep startedAt={review.startedAt} /> : null}
        {step === 'standby' ? (
          <ProjectsStep startedAt={review.startedAt} statuses={['standby', 'someday']} />
        ) : null}
      </div>

      <StepNav
        reviewId={review.id}
        step={step}
        nextStep={nextStep}
        previousStep={previousStep}
        canAdvance={current?.complete ?? false}
        blockedReason={
          current?.complete ? null : blockedReason(step, current?.outstanding ?? 0)
        }
      />
    </Shell>
  );
}

function blockedReason(step: ReviewStep, outstanding: number): string {
  const plural = outstanding === 1 ? '' : 's';
  switch (step) {
    case 'inbox':
      return `${outstanding} capture${plural} still to clarify.`;
    case 'projects':
      return `${outstanding} project${plural} not looked at yet.`;
    case 'stalled':
      return `${outstanding} project${plural} still without a next action.`;
    case 'waiting':
      return `${outstanding} waiting item${plural} not ticked off.`;
    case 'standby':
      return `${outstanding} not reconsidered yet.`;
    default:
      return '';
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-paper">
      <div className="max-w-[44rem] px-8 py-7">{children}</div>
    </div>
  );
}

/** The step rail: where you are, and what is still outstanding behind you. */
function Rail({ progress, step }: { progress: StepProgress[]; step: ReviewStep }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {progress.map((p, i) => {
        const active = p.step === step;
        return (
          <li key={p.step} className="flex items-center gap-1.5">
            <span
              className={[
                'rounded-sm border px-2 py-1',
                active
                  ? 'border-selected bg-selected-bg font-medium text-selected'
                  : p.complete
                    ? 'border-grey-200 bg-grey-100 text-grey-500'
                    : 'border-grey-300 text-grey-600',
              ].join(' ')}
            >
              {p.complete ? '✓ ' : ''}
              {STEP_LABELS[p.step]}
              {!p.complete && p.outstanding > 0 ? (
                <span className="ml-1 tabular-nums">{p.outstanding}</span>
              ) : null}
            </span>
            {i < progress.length - 1 ? <span className="text-grey-300">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

async function InboxStep() {
  const items = await getInboxItems();

  if (items.length === 0) {
    return <Empty>Inbox zero. Nothing to decide.</Empty>;
  }

  return (
    <div className="overflow-hidden rounded-sm border border-grey-200">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/inbox?item=${item.id}`}
          className="block border-b border-grey-150 px-3 py-2 last:border-b-0 hover:bg-grey-100"
        >
          <span className="line-clamp-2 text-[13px] text-grey-800">{item.rawText}</span>
          <span className="mt-0.5 block text-[11px] text-selected">Clarify this →</span>
        </Link>
      ))}
    </div>
  );
}

async function ProjectsStep({
  startedAt,
  statuses,
}: {
  startedAt: Date;
  statuses: ('active' | 'standby' | 'someday')[];
}) {
  const all = await getProjectsForReview(startedAt);
  const rows = all.filter((p) =>
    (statuses as string[]).includes(p.status),
  );

  if (rows.length === 0) return <Empty>Nothing in this bucket.</Empty>;

  return (
    <div className="overflow-hidden rounded-sm border border-grey-200">
      {rows.map((p) => (
        <div
          key={p.id}
          className="flex items-start gap-2.5 border-b border-grey-150 px-3 py-2 last:border-b-0"
        >
          <span className="pt-0.5">
            <ReviewedTick id={p.id} kind="project" reviewed={p.reviewed} />
          </span>

          <div className="min-w-0 flex-1">
            <Link
              href={`/projects/${p.id}`}
              className="block truncate text-[13px] text-grey-800 underline-offset-2 hover:underline"
            >
              {p.title}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-grey-500">
              {p.nextActionCount > 0 ? <span>{p.nextActionCount} next</span> : null}
              {p.waitingCount > 0 ? (
                <span className="text-waiting">{p.waitingCount} waiting</span>
              ) : null}
              {p.standbyReason ? (
                <span className="truncate">until: {p.standbyReason}</span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

async function StalledStep() {
  const rows = await getStalledForReview();

  if (rows.length === 0) {
    return <Empty>Nothing stalled — every active project has a next action.</Empty>;
  }

  return (
    <div className="space-y-3">
      {rows.map((p) => (
        <div key={p.id} className="rounded-sm border border-stale/40 bg-stale-bg px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <Link
              href={`/projects/${p.id}`}
              className="truncate text-[13px] font-medium text-grey-900 underline-offset-2 hover:underline"
            >
              {p.title}
            </Link>
            {p.areaName ? (
              <span className="shrink-0 text-[11px] text-grey-500">{p.areaName}</span>
            ) : null}
          </div>
          <AddNextAction projectId={p.id} />
        </div>
      ))}
    </div>
  );
}

async function WaitingStep({ startedAt }: { startedAt: Date }) {
  const rows = await getWaitingForReview(startedAt);

  if (rows.length === 0) return <Empty>Nothing is waiting on anyone else.</Empty>;

  return (
    <div className="overflow-hidden rounded-sm border border-grey-200">
      {rows.map((a) => {
        const stale = isStale(a.waitingSince);
        const days = daysSince(a.waitingSince);
        return (
          <div
            key={a.id}
            className="flex items-start gap-2.5 border-b border-grey-150 px-3 py-2 last:border-b-0"
          >
            <span className="pt-0.5">
              <ReviewedTick id={a.id} kind="action" reviewed={a.reviewed} />
            </span>

            <div className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-grey-800">{a.title}</span>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                {a.projectTitle ? (
                  <span className="text-grey-500">{a.projectTitle}</span>
                ) : null}
                <span className={stale ? 'font-medium text-stale' : 'text-waiting'}>
                  waiting {days ?? 0}d{stale ? ' — chase it' : ''}
                </span>
                <ChaseButton actionId={a.id} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-grey-200 bg-grey-50 px-3 py-3 text-[13px] text-grey-500">
      {children}
    </p>
  );
}
