import { sql } from 'drizzle-orm';
import {
  customType,
  date,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

/** Full-text vector over a title-ish column plus a plaintext blob. */
const searchVector = (a: string, b: string) =>
  tsvector('search_vector').generatedAlwaysAs(
    (): any =>
      sql`to_tsvector('english', coalesce(${sql.raw(a)}, '') || ' ' || coalesce(${sql.raw(b)}, ''))`,
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

export const actionStatus = pgEnum('action_status', ['next', 'waiting', 'done']);

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

export const attachmentParentType = pgEnum('attachment_parent_type', [
  'project',
  'action',
  'list_item',
]);

export const attachmentKind = pgEnum('attachment_kind', [
  'image',
  'audio',
  'link',
  'file',
]);

export const inboxRawType = pgEnum('inbox_raw_type', ['text', 'photo', 'audio']);

export const inboxStatus = pgEnum('inbox_status', ['pending', 'clarified']);

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('projects_status_idx').on(t.status),
    index('projects_position_idx').on(t.position),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('actions_project_idx').on(t.projectId),
    index('actions_position_idx').on(t.position),
    index('actions_status_idx').on(t.status),
    index('actions_waiting_since_idx').on(t.waitingSince),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('list_items_list_idx').on(t.listId),
    index('list_items_project_idx').on(t.projectId),
    index('list_items_position_idx').on(t.position),
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
    rawType: inboxRawType('raw_type').notNull(),
    driveFileId: text('drive_file_id'),
    rawText: text('raw_text'),
    /** Suggestion layer only — sits on top of the raw artefact. */
    aiSuggestion: jsonb('ai_suggestion').$type<AiSuggestion>(),
    status: inboxStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('inbox_items_status_idx').on(t.status)],
);

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
export type InboxItem = typeof inboxItems.$inferSelect;

export type ListType = (typeof listType.enumValues)[number];
export type ProjectStatus = (typeof projectStatus.enumValues)[number];
export type ActionStatus = (typeof actionStatus.enumValues)[number];
export type ContextDimension = (typeof contextDimension.enumValues)[number];
