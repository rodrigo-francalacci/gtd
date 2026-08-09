import type { ProjectStatus } from '@gtd/db';

/**
 * One-way sync boundary: the app is the source of truth and pushes to
 * Drive/Gmail. There is deliberately no two-way reconciliation — `verifyLinks`
 * reports drift instead of resolving it.
 *
 * Only IDs cross this boundary. Names and paths are Google's business, so a
 * rename in Drive never breaks the link.
 *
 * Tonight this is a no-op implementation. Swapping in the real Google client
 * means implementing this interface and changing `googleSync` below — no
 * caller changes.
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
  issue: 'missing_drive_folder' | 'missing_gmail_label' | 'wrong_parent';
  detail: string;
};

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
 * No-op stub. Returns null IDs so `drive_folder_id` / `gmail_label_id` stay
 * null rather than being filled with fake values that would later look real.
 */
class NoopGoogleSync implements GoogleSync {
  private log(message: string) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[google-sync:stub] ${message}`);
    }
  }

  async createProjectFolder(projectId: string, title: string) {
    this.log(`would create Drive folder Projects/${title} for project ${projectId}`);
    return null;
  }

  async createGmailLabel(projectId: string, title: string) {
    this.log(`would create Gmail label Projects/${title} for project ${projectId}`);
    return null;
  }

  async moveForStatus(
    project: { id: string; driveFolderId: string | null; gmailLabelId: string | null },
    status: ProjectStatus,
  ) {
    this.log(`would move project ${project.id} to ${targetContainer(status)}`);
  }

  async verifyLinks() {
    this.log('verifyLinks is a no-op until the Google client is wired up');
    return [];
  }
}

export const googleSync: GoogleSync = new NoopGoogleSync();
