import './env';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { actions, areasOfFocus, goals, projects } from './schema';

/**
 * One-off: adds the archived example projects to a database that was already
 * seeded before they existed. Idempotent — safe to re-run, does nothing once
 * the examples are present.
 */
async function run() {
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.title, 'Replace the bathroom extractor fan'))
    .limit(1);

  if (existing.length > 0) {
    console.log('Archive examples already present — nothing to do.');
    return;
  }

  const areas = await db.select().from(areasOfFocus);
  const area = (name: string) => areas.find((a) => a.name === name)?.id ?? null;

  const [goal] = await db.select().from(goals).limit(1);

  const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * 864e5);
  const noteDoc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  const [bathroom, conference] = await db
    .insert(projects)
    .values([
      {
        title: 'Replace the bathroom extractor fan',
        areaId: area('Home & Family'),
        goalId: goal?.id ?? null,
        status: 'completed',
        completedAt: monthsAgo(2),
        notes: noteDoc(
          'Model: Vent-Axia VA100LT, 100mm. Fits the existing duct. Isolator switch is in the airing cupboard. Receipt filed with the kitchen paperwork.',
        ),
        searchText:
          'Model: Vent-Axia VA100LT, 100mm. Fits the existing duct. Isolator switch is in the airing cupboard. Receipt filed with the kitchen paperwork.',
      },
      {
        title: 'Speak at the regional conference',
        areaId: area('Work'),
        status: 'completed',
        completedAt: monthsAgo(7),
        notes: noteDoc(
          'Slides live in Drive under Talks. Organiser was Priya — good contact for next year. Room had no HDMI, bring an adapter next time.',
        ),
        searchText:
          'Slides live in Drive under Talks. Organiser was Priya — good contact for next year. Room had no HDMI, bring an adapter next time.',
      },
      {
        title: 'Learn to make sourdough',
        areaId: area('Health'),
        status: 'dropped',
        completedAt: monthsAgo(4),
        notes: noteDoc('Starter kept dying. Revisit when the kitchen is finished.'),
        searchText: 'Starter kept dying. Revisit when the kitchen is finished.',
      },
    ])
    .returning();

  await db.insert(actions).values([
    {
      projectId: bathroom.id,
      title: 'Measure the existing duct',
      status: 'done',
      completedAt: monthsAgo(2),
    },
    {
      projectId: bathroom.id,
      title: 'Fit the new unit',
      status: 'done',
      completedAt: monthsAgo(2),
    },
    {
      projectId: conference.id,
      title: 'Write the talk',
      status: 'done',
      completedAt: monthsAgo(7),
    },
  ]);

  console.log('Added 3 archived example projects and 3 completed actions.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
