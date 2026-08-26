import { sql } from 'drizzle-orm';
import {
  boolean,
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
  uniqueIndex,
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

/**
 * How often a file has actually been opened, and when it last was.
 *
 * The third way to order the files hanging off a project, action or list item,
 * after when they arrived and what they are called. Those two are facts about
 * the file; this is a record of what you have really been doing with it, and
 * the only one that keeps itself honest as a year's worth of uploads piles up.
 * The one you reach for every fortnight rises without anyone remembering to
 * move it, and the one filed with great conviction in March sinks.
 *
 * Two columns rather than one because they answer different questions. The
 * count is how much this has mattered over the file's whole life; the date is
 * whether it still does. Sorting uses the count and breaks ties on the date, so
 * twenty files opened once each come back in the order you last touched them
 * rather than in whatever order Postgres felt like.
 *
 * On `attachments` and `box_items` only — the two things that are files. Rows
 * you *navigate* (a project, an action) are passed through on the way to
 * something else, so counting those would mostly record how the app is laid
 * out. Denormalised rather than a usage table keyed on (type, id), which would
 * put a join in the ORDER BY of a list that is only ever sorted, never queried,
 * on this column.
 */
const usage = {
  useCount: integer('use_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
};

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
  /**
   * Filed in a box — a reference, not a commitment.
   *
   * The missing answer to "what is this?". Everything else here turns a
   * capture into something you have to *do*, and the honest answer is often
   * that you do not have to do anything with it and would like to be able to
   * find it later. That is what a box is for, and without this the only routes
   * into one were the composer and the scanner: a photographed receipt taken
   * on the way past had to be trashed or made into a fake action.
   *
   * It does not blur the inbox and the box, which meet at `box_item_links` and
   * nowhere else. This is the *clarify decision* that a thing belongs in one,
   * and the inbox is still emptied by it.
   */
  'filed',
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
  /**
   * What there is to spend, for a purchases list. Null means no ceiling.
   *
   * Without it the budget could only say what things cost, never whether you
   * could afford them — and "would commit £400" is not a decision until you
   * know what it leaves. On the list rather than in preferences because two
   * purchases lists are two separate pots, which is most of the reason to have
   * a second one.
   *
   * Plain currency units, like `fields.cost`, so the two can be subtracted
   * without a scaling rule that only one of them knows about.
   */
  budget: doublePrecision('budget'),
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
    /**
     * TipTap JSON, like every other notes column. A list item was title-only
     * until a capture could carry a note: "Basic training" tells you nothing
     * in a year, and the sentence explaining why you wrote it down is the part
     * worth keeping.
     */
    notes: jsonb('notes'),
    /** Plaintext flattened from `notes`, kept in sync by the app for search. */
    searchText: text('search_text'),
    searchVector: searchVector('title', 'search_text'),
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
    /**
     * The name Drive is known to hold, as against `name`, which is the name
     * this app wants it to have.
     *
     * Two columns because a rename here cannot call Google — no mutation may —
     * so the difference between them *is* the outstanding work, and the sweep
     * on the cron tick is what closes it. The same job `box_items.title` does
     * against `box_items.name`, which needed no second column only because a
     * document already had somewhere to keep the name it was given.
     *
     * Null means never pushed and nothing to compare: rows that predate this,
     * which are left alone rather than renamed on the strength of a guess.
     */
    driveName: text('drive_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    /** Populated asynchronously by the enrichment queue. */
    transcription: text('transcription'),
    ocrText: text('ocr_text'),
    searchVector: searchVector('transcription', 'ocr_text'),
    // The row this was built for. Opening a file is the clearest "use" there
    // is in the app — a deliberate click on a thing you wanted to look at,
    // rather than a row you passed over on the way somewhere else.
    ...usage,
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_use_count_idx').on(t.useCount),
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
// The Big Box — documents, filed by arriving
// ---------------------------------------------------------------------------

/**
 * A box: a Drive folder whose contents are read, named, described and tagged.
 *
 * Named for the box of letters and documents this is copied from — everything
 * important went in, newest on top, and you found things by remembering
 * roughly when they arrived. That is the whole filing system, and it is a good
 * one: it costs nothing at the moment of filing, which is the moment you will
 * not spend effort.
 *
 * Deliberately separate from the GTD side. A document is not a commitment and
 * filing one is not clarifying — the inbox exists to be emptied, and a box
 * exists to be kept. They meet only at `box_item_links`, where a document
 * becomes a project's resource without leaving the box.
 *
 * One box is the default (`is_default`), the Big Box itself. The others are
 * for things that never overlap with it — receipts, fuel, a journal — and
 * deleting one refiles its documents into the default rather than losing them.
 */
export const boxes = pgTable(
  'boxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /**
     * The Drive folder documents are uploaded into. Created by this app, which
     * is what makes `drive.file` enough to read them afterwards — a folder the
     * app merely knows the id of is a folder it cannot open.
     */
    driveFolderId: text('drive_folder_id'),
    /**
     * What this box is for, in a sentence, handed to the model before the
     * categories. "Fuel receipts for a tax return" tells it more about which
     * tags to reach for than the tag names ever will.
     */
    instruction: text('instruction').notNull().default(''),
    /**
     * How to write the title and summary for documents filed here.
     *
     * A second field rather than more prose in the first, because the two land
     * in different places in the prompt and answer different questions: the
     * instruction says what these documents *are*, which is what tagging turns
     * on, and this says what a good description of one looks like — "include
     * the items bought and the final total" only makes sense for a box full of
     * receipts, and would be noise in the paragraph that guides the tags.
     */
    rules: text('rules').notNull().default(''),
    isDefault: boolean('is_default').notNull().default(false),
    position: doublePrecision('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('boxes_default_idx').on(t.isDefault)],
);

/**
 * A dimension of tags within one box: "Issued By", "Type of Document".
 *
 * Per box rather than global, because the axes that matter for a bill are not
 * the ones that matter for a fuel receipt, and offering all of them everywhere
 * is how a model ends up tagging a supermarket receipt with "HMRC".
 */
export const boxCategories = pgTable(
  'box_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boxId: uuid('box_id')
      .notNull()
      .references(() => boxes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * Whether the model may propose a value that isn't on the list yet.
     *
     * Off by default and scoped to the one category that needs it — a city, on
     * fuel receipts, where the list can't be written in advance. Left on
     * everywhere it wasn't needed, it turns a controlled vocabulary into
     * free text one plausible-looking tag at a time.
     */
    allowNewTags: boolean('allow_new_tags').notNull().default(false),
    position: doublePrecision('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('box_categories_box_idx').on(t.boxId)],
);

/**
 * An allowed tag. The vocabulary is user data, managed in the app.
 *
 * The model may only *use* these, never add to them: what comes back is
 * matched against this table and anything else is dropped. That check is code,
 * not a line in the prompt, because a prompt is a request and this is a rule —
 * ask a model for one of five values often enough and eventually you get a
 * sixth, and by then it is in your data.
 */
export const boxTags = pgTable(
  'box_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => boxCategories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: doublePrecision('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('box_tags_category_idx').on(t.categoryId),
    // Case-insensitive, so "Tesco" and "tesco" can't both exist and split a
    // year of receipts across two tags that look identical in the UI.
    uniqueIndex('box_tags_unique_idx').on(t.categoryId, sql`lower(${t.name})`),
  ],
);

/** Whether a document has been read yet. */
export const boxItemStatus = pgEnum('box_item_status', [
  'pending',
  'ready',
  'failed',
]);

/**
 * What an entry in a box is.
 *
 * A box began as somewhere documents land, and it turns out that is half of
 * it: the reason the original box of letters worked is that it held everything
 * you might want to find later, in the order it arrived. A thought about a
 * document belongs next to the document, not in a separate system — so the
 * feed takes messages and places as well as files, and reads the way a chat
 * does, which is the only interface anyone has ever needed teaching for.
 *
 * `document` is the only kind with a file, and so the only kind the model
 * reads. A note is already in its final form.
 */
/**
 * What an entry in a box *is*.
 *
 * `email` is a document with a provenance. It has a file like any other — the
 * message rendered to HTML, in Drive, app-created like everything else — but it
 * also has a sender, a sent date and a permalink back to Gmail, and it is the
 * one kind that arrives without anyone touching this app: you label a message
 * in Gmail and the bridge files it.
 *
 * A kind rather than a mime type, because the file is `text/html` and so are a
 * dozen unrelated things. What makes it an email is where it came from.
 */
export const boxItemKind = pgEnum('box_item_kind', [
  'document',
  'note',
  'location',
  'link',
  'email',
]);

/**
 * One document in a box.
 *
 * `captured_at` is the permanent mark of when it arrived and is what the feed
 * is ordered and grouped by. `doc_date` is the date printed *on* the document,
 * which the model reads out and which is frequently not the same — a bill that
 * arrives in August is dated July, and both facts are worth keeping.
 *
 * `name` is the Drive filename, which carries a date prefix so the folder
 * sorts usefully when opened in Drive itself. The app shows `title` instead:
 * the prefix is a filing artefact, not something to read.
 */
export const boxItems = pgTable(
  'box_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict rather than cascade: deleting a box must refile its documents,
    // never destroy them. If that ever gets forgotten the delete fails loudly
    // instead of quietly taking a year of receipts with it.
    boxId: uuid('box_id')
      .notNull()
      .references(() => boxes.id, { onDelete: 'restrict' }),
    kind: boxItemKind('kind').notNull().default('document'),
    /** Null for anything with no file — a note, a place. */
    driveFileId: text('drive_file_id'),
    /** The Drive filename. Empty for entries that aren't files. */
    name: text('name').notNull().default(''),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    /**
     * For a document these are the model's, written once the file is read. For
     * a note, `description` is the message you typed and `title` stays null —
     * a note is not a summary of anything, it is the thing itself.
     */
    title: text('title'),
    description: text('description'),
    /**
     * Where you were, for a `location` entry. Two columns rather than a blob
     * because a coordinate is two numbers and will one day be worth querying
     * on; a label, if there is one, goes in `description` like any other note.
     */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** The address a `link` entry points at, and what gets read to fill it in. */
    url: text('url'),
    /**
     * A link's picture, as the address the page itself advertises.
     *
     * Kept as a URL and proxied rather than copied into Drive: a preview image
     * is the page's, not ours, and the failure mode of a stale one is a
     * missing thumbnail rather than a broken entry. It is never rendered
     * directly — see the thumbnail route — because pointing the browser at a
     * third-party host would tell that host who is reading, and every time.
     */
    imageUrl: text('image_url'),
    docDate: date('doc_date'),
    /**
     * When this stops being worth keeping. Null means forever, which is the
     * default and the point of a box.
     *
     * Some documents have a known shelf life at the moment they arrive — the
     * receipt proving a card bill was paid is worth three months and nothing
     * after that — and deciding then is far easier than reviewing a thousand
     * of them later. Set on arrival, acted on by the worker.
     *
     * A date rather than a duration, because a duration would have to be
     * re-evaluated against a start that could itself be edited: `captured_at`
     * is correctable, and a "3 months" that silently moved when you fixed an
     * arrival date would be a surprise. This is a decision, already made.
     */
    expiresAt: date('expires_at'),
    /** The full transcription, so search can reach inside the document. */
    text: text('text'),
    status: boxItemStatus('status').notNull().default('pending'),
    /**
     * Description, transcription and tag names flattened together. Same
     * arrangement as `list_items`: the vector is generated from a column the
     * app maintains, so anything that writes one must write the other.
     */
    searchText: text('search_text'),
    searchVector: searchVector('title', 'search_text'),
    ...usage,
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('box_items_use_count_idx').on(t.useCount),
    index('box_items_box_idx').on(t.boxId, t.capturedAt),
    index('box_items_drive_idx').on(t.driveFileId),
    index('box_items_search_idx').using('gin', t.searchVector),
  ],
);

/**
 * A line about the day itself, under the date in every box's feed.
 *
 * Not a `box_items` row, and the distinction is the whole reason this table
 * exists. An entry is a *thing that arrived* — it has a time, a place in the
 * order, a file behind it more often than not. This is about the day, which
 * has no arrival and cannot be one entry among the others without pretending
 * to be: it would need a position in a feed it is the heading of.
 *
 * Its job is context rather than content. Three receipts and a screenshot from
 * a Tuesday in March tell you what you filed; "drove to Bristol for the
 * handover, van broke down" tells you what you were *doing*, which is what you
 * actually search your memory with when hunting for one of them.
 *
 * Keyed on the day alone, not on the box and the day. You only had the one
 * Tuesday: the boxes are how documents are grouped, and the day you had is the
 * same day whichever shelf you happen to be looking at. Writing it per box
 * would mean the note you left in Receipts was invisible from Feed and the
 * same afternoon got described twice.
 */
export const boxDays = pgTable(
  'box_days',
  {
    /** Local calendar day, the same key every feed groups by. */
    day: date('day').primaryKey(),
    note: text('note').notNull().default(''),
    searchVector: searchVector('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('box_days_search_idx').using('gin', t.searchVector)],
);

export const boxItemTags = pgTable(
  'box_item_tags',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => boxItems.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => boxTags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tagId] }),
    index('box_item_tags_tag_idx').on(t.tagId),
  ],
);

/**
 * A document, cited by something on the GTD side.
 *
 * A link rather than an `attachments` row pointing at the same Drive file:
 * detaching an attachment trashes the file it points at, which for a document
 * that lives in a box would mean tidying a project's resources quietly gutted
 * the archive. Linking and unlinking here touch nothing in Drive.
 *
 * Reuses `attachment_parent_type` because it is already the list of things a
 * file can hang off, and a second enum saying the same thing is a second enum
 * to keep in step.
 */
export const boxItemLinks = pgTable(
  'box_item_links',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => boxItems.id, { onDelete: 'cascade' }),
    parentType: attachmentParentType('parent_type').notNull(),
    parentId: uuid('parent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.parentType, t.parentId] }),
    index('box_item_links_parent_idx').on(t.parentType, t.parentId),
  ],
);

/**
 * Reading and classifying a document.
 *
 * A third queue, for the reason the second one exists: `sync_jobs` is keyed on
 * a project and pushes out to Google, `enrichment_jobs` is keyed on an
 * attachment and pulls text in, and this is keyed on a box item and does
 * something neither does — it returns a name, a summary, a date and a set of
 * tags drawn from a vocabulary that belongs to the box. One cron tick drains
 * all three.
 */
export const boxJobs = pgTable(
  'box_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => boxItems.id, { onDelete: 'cascade' }),
    status: syncJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('box_jobs_status_idx').on(t.status, t.runAfter),
    index('box_jobs_item_idx').on(t.itemId),
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
  /**
   * No longer read: the preview pane takes whatever the detail pane doesn't
   * need, so there is no width to choose. Kept because dropping a column to
   * reclaim four bytes on a single row is a migration with nothing on the
   * other side of it, and because the choice may come back.
   */
  previewPaneWidth: integer('preview_pane_width'),
  /** 'comfortable' | 'compact' | 'simple' */
  viewMode: text('view_mode'),
  /**
   * 'list' | 'gallery' — how a box is laid out.
   *
   * Its own preference rather than a fourth density, because it answers a
   * different question. The densities trade metadata for rows and apply
   * everywhere; this one only means anything where the things listed have a
   * picture, and a scanned document is recognised by its shape long before
   * its title is read.
   */
  boxView: text('box_view'),
  /** 'light' | 'dark'. Null means "whatever the operating system says". */
  theme: text('theme'),
  /**
   * Google calendars to leave *out* of the calendar view.
   *
   * Stored as what to hide rather than what to show, and the asymmetry is the
   * whole point: a calendar you add in Google later is not in this list, so it
   * appears. Storing an allow-list would make a newly added calendar silently
   * absent — the same failure that decided the scope, where a day view that
   * quietly omits a calendar is worse than one showing too much, because you
   * would trust it. A calendar deleted at Google leaves an id here that simply
   * never matches again, which costs nothing and is not worth pruning: pruning
   * needs a complete calendar list to be safe, and a momentarily incomplete one
   * would silently un-hide things.
   *
   * Null is a real value, as with `theme`: it means no choice has been made
   * here, and Google's own ticked/unticked state decides. The first explicit
   * choice writes a list and Google's flags stop being consulted — one owner at
   * a time, never two.
   */
  hiddenCalendars: jsonb('hidden_calendars').$type<string[]>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * How one particular list is ordered, and whether it is cut into groups.
 *
 * Its own table rather than more columns on `preferences`, because unlike the
 * density and the theme this is not one answer for the whole app. Projects
 * read best alphabetically, an inbox reads oldest-first because that is the
 * order you work through it, and a box reads newest-first because that is the
 * order things arrived. A single setting would force one of those onto all
 * three, which is the same mistake as having no setting at all.
 *
 * The key names a *view*, not a table: `projects`, `now`, `inbox`,
 * `list:<uuid>`, `box:<uuid>`. Two views over the same rows are two different
 * things to look at and get their own answer — Now and a project's own action
 * list are the obvious pair.
 *
 * A missing row means the view's own default, which is whatever it did before
 * any of this existed. Nothing is written until something is chosen, so an
 * untouched app has an empty table and behaves exactly as it always did.
 */
export const viewPrefs = pgTable('view_prefs', {
  key: text('key').primaryKey(),
  /**
   * `'comfortable' | 'compact' | 'simple'` for this list, or null to follow
   * the app-wide default in `preferences`.
   *
   * Density was one setting for everything, which made it the wrong setting
   * for everything: an inbox is a queue you scan and wants titles only, a
   * purchases list is a table of costs and wants the columns. Choosing on one
   * silently re-made the choice on the other, so you set it again every time
   * you moved — which is not a preference, it is a chore.
   *
   * Here rather than a table of its own because this is already "what a
   * particular view remembers", and sort lives in the same row for the same
   * reason. Null is the normal state: nothing is written until something is
   * picked, so an untouched app still has one global answer.
   */
  density: text('density'),
  /**
   * `'list' | 'timeline'` — whether this list is read in the order you put it
   * in, or in the order it arrived.
   *
   * A different question from density, which trades metadata for rows and
   * applies within either. A purchases list you are ranking by hand and a
   * purchases list you are reading as a history of what you decided are two
   * ways of looking at one set of rows, and the manual order that makes the
   * first useful is exactly what the second has to ignore.
   *
   * Null is the normal state and means the ordered list, which is what a list
   * has always been.
   */
  layout: text('layout'),
  /** 'manual' | 'arrival' | 'alpha' | 'usage'. */
  sort: text('sort'),
  /** Newest/Z-A/most-used first. Ignored by 'manual', which has no direction. */
  descending: boolean('descending').notNull().default(false),
  /**
   * Whether to cut the list into headed groups. What the groups *are* follows
   * from the sort — days for arrival, first letters for A–Z — because a
   * grouping that disagrees with the ordering produces headings whose contents
   * are scattered through the list.
   */
  grouped: boolean('grouped').notNull().default(false),
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

export type Box = typeof boxes.$inferSelect;
export type NewBox = typeof boxes.$inferInsert;
export type BoxCategory = typeof boxCategories.$inferSelect;
export type BoxTag = typeof boxTags.$inferSelect;
export type BoxItem = typeof boxItems.$inferSelect;
export type BoxItemStatus = (typeof boxItemStatus.enumValues)[number];
export type BoxItemKind = (typeof boxItemKind.enumValues)[number];
export type ViewPref = typeof viewPrefs.$inferSelect;
