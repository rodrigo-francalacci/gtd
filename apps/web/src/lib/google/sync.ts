import type { ProjectStatus } from '@gtd/db';

/**
 * One-way sync boundary: the app is the source of truth and pushes to
 * Drive/Gmail. There is deliberately no two-way reconciliation — `verifyLinks`
 * reports drift instead of resolving it.
 *
 * Only IDs cross this boundary. Names and paths are Google's business, so a
 * rename in Drive never breaks the link.
 */
export interface GoogleSync {
  /** Returns the Drive folder ID created for a new project. */
  createProjectFolder(projectId: string, title: string): Promise<string | null>;

  /** Returns the Gmail label ID created for a new project. */
  createGmailLabel(projectId: string, title: string): Promise<string | null>;

  /** Moves folder + label between Projects/Standby/Archive on status change. */
  moveForStatus(
    project: {
      id: string;
      title?: string;
      driveFolderId: string | null;
      gmailLabelId: string | null;
    },
    status: ProjectStatus,
  ): Promise<void>;

  /** Manual drift report — never mutates. */
  verifyLinks(): Promise<LinkDrift[]>;
}

export type LinkDrift = {
  projectId: string;
  projectTitle: string;
  issue:
    | 'missing_drive_folder'
    | 'missing_gmail_label'
    | 'wrong_parent'
    | 'not_linked';
  detail: string;
};

/**
 * Everything the app creates lives under one root, in Drive and in Gmail
 * alike. Without it the app's containers would scatter through a label list
 * that already has its own taxonomy, and a top-level "Projects" would be easy
 * to confuse with one you made yourself.
 */
export const ROOT = 'GTD';

/** Where a project's folder/label should live for a given status. */
export function targetContainer(status: ProjectStatus): 'Projects' | 'Standby' | 'Archive' {
  switch (status) {
    case 'active':
      return 'Projects';
    case 'standby':
    case 'someday':
      return 'Standby';
    case 'completed':
    case 'dropped':
      return 'Archive';
  }
}

/**
 * The container path a project belongs in, below the root.
 *
 * Archived work is split by the year it finished — `Archive/2026` — because an
 * archive you actually search is one organised by when, and an undivided
 * folder of every project you have ever completed stops being navigable after
 * a couple of years.
 *
 * Falls back to the current year only if a finished project somehow has no
 * completion date; better a slightly wrong year than a project filed nowhere.
 */
export function containerPath(
  status: ProjectStatus,
  completedAt: Date | null,
): string[] {
  const container = targetContainer(status);
  if (container !== 'Archive') return [container];

  const year = (completedAt ?? new Date()).getFullYear();
  return [container, String(year)];
}

/**
 * Drive and Gmail both reject some characters in names, and a project title
 * is free text. `/` is the worst offender: in Gmail it would silently create
 * a nested label.
 */
export function safeName(title: string): string {
  return title.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** The full Gmail label a project should have, e.g. `GTD/Archive/2026/Thing`. */
export function projectLabelName(
  status: ProjectStatus,
  completedAt: Date | null,
  title: string,
): string {
  return [ROOT, ...containerPath(status, completedAt), safeName(title)].join('/');
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * Gmail addresses a label by *name* in the URL, not by id — the id we store is
 * only good for the API. The name is ours to compute, since the app is the one
 * that set it; if you rename the label in Gmail this link goes stale, which is
 * exactly the drift `verifyLinks` exists to report.
 *
 * `u/0` is the browser's first signed-in Google account. There is no way to
 * address an account by id in a Gmail URL.
 */
export function gmailLabelUrl(labelName: string): string {
  const encoded = labelName.replace(/ /g, '+').replace(/\//g, '%2F');
  return `https://mail.google.com/mail/u/0/#label/${encoded}`;
}
