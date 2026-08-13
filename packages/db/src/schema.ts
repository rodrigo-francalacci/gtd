import { sql } from 'drizzle-orm';
import {
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** The one and only preferences row. */
export const SINGLETON = 'singleton';

/**
 * Postgres tsvector. Drizzle has no first-class type for it, so we declare a
 * minimal custom one — we only ever read/write it through generated columns
 * and `to_tsquery` comparisons, never as a JS value.
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * Full-text vector over one column, or a title-ish column plus a plaintext
 * blob. Passing the same column twice would double its term frequency and
 * skew `ts_rank`, so the second argument is optional rather than repeated.
 */
const searchVector = (a: string, b?: string) =>
  tsvector('search_vector').generatedAlwaysAs((): any =>
    b === undefined
      ? sql`to_tsvector('english', coalesce(${sql.raw(a)}, ''))`
      : sql`to_tsvector('english', coalesce(${sql.raw(a)}, '') || ' ' || coalesce(${sql.raw(b)}, ''))`,
  );

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const projectStatus = pgEnum('project_status', [
  'active',
  'standby',
  'someday',
  'completed',
  'dropped',
]);

/**
 * `future` is parked work: known, wanted, but deliberately not a candidate for
 * "what can I do now". It keeps a project's later steps recorded without them
 * competing for attention today, and it doesn't count towards a next action —
 * a project whose only actions are future is still stalled, which is correct.
 */
export const actionStatus = pgEnum('action_status', [
  'next',
  'future',
  'waiting',
  'done',
]);

export const contextDimension = pgEnum('context_dimension', [
  'place',
  'time',
  'energy',
  'person',
]);

export const listType = pgEnum('list_type', [
  'someday_maybe',
  'purchases',
  'reference',
  'checklist',
]);

/**
 * `inbox_item` is here so a captured photo or recording is a real attachment
 * rather than a bare Drive id on the inbox row.
 *
 * The alternative — `inbox_items.drive_file_id` — stores the id and nothing
 * else: no name, no mime type, no size, and no enrichment, because the
 * enrichment queue and the search union both key on an attachment. A photo
 * captured that way would be the only file in the app that can't be read,
 * previewed or found, which is the exact opposite of what capture is for.
 */
export const attachmentParentType = pgEnum('attachment_parent_type', [
  'project',
  'action',
  'list_item',
  'inbox_item',
]);

export const attachmentKind = pgEnum('attachment_kind', [
  'image',
  'audio',
  'link',
  'file',
]);

export const inboxRawType = pgEnum('inbox_raw_type', ['text', 'photo', 'audio']);

export const inboxStatus = pgEnum('inbox_status', ['pending', 'clarified']);

/** What a raw capture turned into once it was clarified. */
export const inboxOutcome = pgEnum('inbox_outcome', [
  'next_action',
  'waiting',
  'project',
  'list_item',
  'done',
  'trashed',
]);

// ---------------------------------------------------------------------------
// Horizons: areas of focus and goals
// ---------------------------------------------------------------------------

export const areasOfFocus = pgTable('areas_of_focus', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  notes: jsonb('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    areaId: uuid('area_id').references(() => areasOfFocus.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    targetDate: date('target_date'),
    notes: jsonb('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('goals_area_idx').on(t.areaId)],
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    areaId: uuid('area_id').references(() => areasOfFocus.id, { onDelete: 'set null' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    status: projectStatus('status').notNull().default('active'),
    /** The return condition. Required by the app whenever status = 'standby'. */
    standbyReason: text('standby_reason'),
    /** Google IDs only — never names or paths. */
    driveFolderId: text('drive_folder_id'),
    gmailLabelId: text('gmail_label_id'),
    /** TipTap (ProseMirror) document. */
    notes: jsonb('notes'),
    /** Plaintext flattened from `notes`, kept in sync by the app for search. */
    searchText: text('search_text'),
    searchVector: searchVector('title', 'search_text'),
    /** Manual sort order. See the note on `actions.position`. */
    position: doublePrecision('position'),
    /**
     * When the project was finished — set on the move to completed or dropped,
     * cleared if it's reopened. Distinct from `updated_at`, which any edit
     * bumps and so can't be trusted to date the archive.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** When this was last ticked off in a weekly review. */
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('projects_status_idx').on(t.status),
    index('projects_position_idx').on(t.position),
    index('projects_completed_at_idx').on(t.completedAt),
    index('projects_area_idx').on(t.areaId),
    index('projects_goal_idx').on(t.goalId),
    index('projects_search_idx').using('gin', t.searchVector),
  ],
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: actionStatus('status').notNull().default('next'),
    /** Stamped when status becomes 'waiting'; drives the staleness surface. */
    waitingSince: date('waiting_since'),
    /**
     * Who or what you're waiting on, as a reference to a `person`-dimension
     * context rather than free text.
     *
     * Shared with the agenda side of contexts on purpose: the people you're
     * waiting on and the people you have things to raise with are the same
     * people. Making it an entity is what stops "Neil", "neil" and "Neil S"
     * becoming three different parties, and lets a rename fix every action at
     * once. `set null` on delete so losing the party never destroys the action.
     */
    waitingOnId: uuid('waiting_on_id').references(() => contexts.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: jsonb('notes'),
    searchText: text('search_text'),
    searchVector: searchVector('title', 'search_text'),
    /**
     * Manual sort order, as a float rather than a contiguous integer rank.
     * Dropping an item between two neighbours writes the midpoint of their
     * positions, touching one row instead of renumbering the list. This is
     * what makes reordering a *filtered* view correct: the Now list may be
     * showing 3 of 40 actions, and the midpoint of two visible neighbours
     * still lands in the right place globally.
     */
    position: doublePrecision('position'),
    /** When this was last ticked off in a weekly review. */
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('actions_project_idx').on(t.projectId),
    index('actions_position_idx').on(t.position),
    index('actions_status_idx').on(t.status),
    index('actions_waiting_since_idx').on(t.waitingSince),
    index('actions_waiting_on_idx').on(t.waitingOnId),
    index('actions_search_idx').using('gin', t.searchVector),
  ],
);

// ---------------------------------------------------------------------------
// Contexts (freeform, typed by dimension)
// ---------------------------------------------------------------------------

export const contexts = pgTable(
  'contexts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    dimension: contextDimension('dimension').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contexts_dimension_idx').on(t.dimension)],
);

export const actionContexts = pgTable(
  'action_contexts',
  {
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    contextId: uuid('context_id')
      .notNull()
      .references(() => contexts.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.actionId, t.contextId] }),
    index('action_contexts_context_idx').on(t.contextId),
  ],
);

// ---------------------------------------------------------------------------
// Lists — candidates, not commitments
// ---------------------------------------------------------------------------

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: listType('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Purchases-list shape for `fields`. Other list types carry their own shape;
 * the column stays untyped in Postgres and is narrowed in TS per list type.
 */
export type PurchaseFields = {
  cost?: number;
  impact?: 'blocks' | 'improves' | 'nice_to_have';
  where?: 'online' | 'in_town';
};

export const listItems = pgTable(
  'list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Type-specific data, e.g. PurchaseFields for a 'purchases' list. */
    fields: jsonb('fields').$type<PurchaseFields & Record<string, unknown>>(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Set once promoted — the item became a real commitment. */
    promotedActionId: uuid('promoted_action_id').references(() => actions.id, {
      onDelete: 'set null',
    }),
    /** Manual sort order. See the note on `actions.position`. */
    position: doublePrecision('position'),
    /** Title only — `fields` holds costs and enums, nothing worth searching. */
    searchVector: searchVector('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('list_items_list_idx').on(t.listId),
    index('list_items_project_idx').on(t.projectId),
    index('list_items_position_idx').on(t.position),
    index('list_items_search_idx').using('gin', t.searchVector),
  ],
);

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentType: attachmentParentType('parent_type').notNull(),
    parentId: uuid('parent_id').notNull(),
    kind: attachmentKind('kind').notNull(),
    driveFileId: text('drive_file_id'),
    /**
     * Kept beside the Drive id rather than fetched. Listing attachments is a
     * read on every project and action pane, and none of those may wait on
     * Drive — a filename is not worth a round trip, and the app still can't
     * render a row for a file whose name it would have to ask for.
     */
    name: text('name').notNull().default(''),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    /** Populated asynchronously by the enrichment queue. */
    transcription: text('transcription'),
    ocrText: text('ocr_text'),
    searchVector: searchVector('transcription', 'ocr_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_parent_idx').on(t.parentType, t.parentId),
    index('attachments_search_idx').using('gin', t.searchVector),
  ],
);

// ---------------------------------------------------------------------------
// Inbox — raw capture, never overwritten by AI
// ---------------------------------------------------------------------------

export type AiSuggestion = {
  projectId?: string;
  contextIds?: string[];
  phrasing?: string;
  confidence?: number;
};

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * What the capture *is*, which is what the row renders as. A capture can
     * carry both a photo and a sentence about it; `photo` and `audio` mean the
     * artefact is the point and the text is a note beside it.
     */
    rawType: inboxRawType('raw_type').notNull(),
    /**
     * Superseded by an `attachments` row with `parent_type = 'inbox_item'`,
     * which carries the name, type, size and — the reason for the change — the
     * enrichment that makes a captured photo searchable. Kept because a raw
     * capture is immutable, so the handful of rows written before the move
     * keep pointing at their file.
     */
    driveFileId: text('drive_file_id'),
    rawText: text('raw_text'),
    /** Suggestion layer only — sits on top of the raw artefact. */
    aiSuggestion: jsonb('ai_suggestion').$type<AiSuggestion>(),
    status: inboxStatus('status').notNull().default('pending'),
    /**
     * What clarifying produced. The raw capture above is never edited or
     * deleted, so these record the decision beside the original rather than
     * replacing it — including `trashed`, which keeps the evidence that
     * something was captured and consciously dropped.
     */
    outcome: inboxOutcome('outcome'),
    outcomeId: uuid('outcome_id'),
    clarifiedAt: timestamp('clarified_at', { withTimezone: true }),
    /** The raw capture stays searchable after it's been clarified. */
    searchVector: searchVector('raw_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inbox_items_status_idx').on(t.status),
    index('inbox_items_search_idx').using('gin', t.searchVector),
  ],
);

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

export const reviewStep = pgEnum('review_step', [
  'inbox',
  'projects',
  'stalled',
  'waiting',
  'standby',
  'done',
]);

/**
 * A weekly review sitting.
 *
 * Persisted rather than held in the client because the review is gated: "you
 * reviewed this project" has to survive a refresh, or the gates would be
 * theatre. `started_at` is the reference point — an item counts as reviewed
 * when its `last_reviewed_at` is at or after it.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    step: reviewStep('step').notNull().default('inbox'),
  },
  (t) => [index('reviews_completed_idx').on(t.completedAt)],
);

// ---------------------------------------------------------------------------
// Sync outbox
// ---------------------------------------------------------------------------

export const syncJobKind = pgEnum('sync_job_kind', [
  'create_project_links',
  'move_project_links',
]);

export const syncJobStatus = pgEnum('sync_job_status', [
  'pending',
  'running',
  'done',
  'failed',
]);

/**
 * Outbox for Drive/Gmail work.
 *
 * The brief forbids running sync inside a request handler: a serverless
 * function would time out and the user would be left waiting on Google to
 * create a folder. Mutations enqueue a row and return immediately; a cron
 * worker drains the queue.
 *
 * Recording the intent in the same database as the change it follows also
 * means a failed push is visible and retryable, rather than lost.
 */
export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: syncJobKind('kind').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: syncJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Earliest time to try again — set on retry for backoff. */
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('sync_jobs_status_idx').on(t.status, t.runAfter),
    index('sync_jobs_project_idx').on(t.projectId),
  ],
);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Server-side sessions. The cookie carries only a random id, so a stolen
 * cookie can be revoked by deleting the row — which a self-contained signed
 * token could not offer.
 */
export const sessions = pgTable(
  'sessions',
  {
    /** High-entropy random string, not a uuid — this is a bearer token. */
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
);

/**
 * The stored Google grant. Single-user app, so one row pinned to a fixed id.
 *
 * The refresh token is the durable part — Google only returns it on the first
 * consent (or with prompt=consent), so it must never be overwritten with null
 * when a later token response omits it.
 */
export const googleAccounts = pgTable('google_accounts', {
  id: text('id').primaryKey().default(SINGLETON),
  email: text('email').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  /** When the access token expires; the refresh token outlives it. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Space-separated scopes actually granted, which may be fewer than asked. */
  scope: text('scope'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Enrichment queue
// ---------------------------------------------------------------------------

/**
 * `ocr` covers anything read by eye — a photographed page, a whiteboard, a
 * PDF. `transcribe` is speech. They are separate kinds because they need
 * different providers, not because the queue cares.
 */
export const enrichmentJobKind = pgEnum('enrichment_job_kind', [
  'ocr',
  'transcribe',
]);

/**
 * Reads an attachment so its contents become searchable.
 *
 * Deliberately a second queue rather than more kinds on `sync_jobs`: that one
 * is keyed on a project and exists to push *out* to Google, this one is keyed
 * on an attachment and pulls text *in*. Sharing a table would mean a nullable
 * foreign key on both and a worker that has to ask which sort of row it got.
 * The status enum is shared, because a job is a job.
 */
export const enrichmentJobs = pgTable(
  'enrichment_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: enrichmentJobKind('kind').notNull(),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    status: syncJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('enrichment_jobs_status_idx').on(t.status, t.runAfter),
    index('enrichment_jobs_attachment_idx').on(t.attachmentId),
  ],
);

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * UI preferences. Single-user app, so this is one row pinned to a fixed id
 * rather than a per-user table.
 *
 * In the database rather than a cookie so settings follow the account instead
 * of the browser — the same reason they'll still be right when the phone app
 * arrives.
 */
export const preferences = pgTable('preferences', {
  id: text('id').primaryKey().default(SINGLETON),
  /** Width of the middle pane in pixels. Null means "use the default". */
  listPaneWidth: integer('list_pane_width'),
  /** Width of the file preview pane. Same convention. */
  previewPaneWidth: integer('preview_pane_width'),
  /** 'comfortable' | 'compact' */
  viewMode: text('view_mode'),
  /** 'light' | 'dark'. Null means "whatever the operating system says". */
  theme: text('theme'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type AreaOfFocus = typeof areasOfFocus.$inferSelect;
export type NewAreaOfFocus = typeof areasOfFocus.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Action = typeof actions.$inferSelect;
export type NewAction = typeof actions.$inferInsert;
export type Context = typeof contexts.$inferSelect;
export type NewContext = typeof contexts.$inferInsert;
export type List = typeof lists.$inferSelect;
export type ListItem = typeof listItems.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type EnrichmentJobKind = (typeof enrichmentJobKind.enumValues)[number];
export type InboxItem = typeof inboxItems.$inferSelect;
export type InboxRawType = (typeof inboxRawType.enumValues)[number];

export type ListType = (typeof listType.enumValues)[number];
export type ProjectStatus = (typeof projectStatus.enumValues)[number];
export type ActionStatus = (typeof actionStatus.enumValues)[number];
export type ContextDimension = (typeof contextDimension.enumValues)[number];
export type AttachmentKind = (typeof attachmentKind.enumValues)[number];
export type AttachmentParentType = (typeof attachmentParentType.enumValues)[number];
