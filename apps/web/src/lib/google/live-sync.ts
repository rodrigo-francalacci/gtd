import 'server-only';

import { db, projects } from '@gtd/db';
import { inArray } from 'drizzle-orm';
import { getGrant } from '@/lib/auth/token';
import { hasSyncScopes } from '@/lib/auth/google';
import {
  ensureFolder,
  ensureLabel,
  getFile,
  getLabel,
  moveFile,
  renameLabel,
} from './client';
import {
  ROOT,
  containerPath,
  projectLabelName,
  safeName,
  type GoogleSync,
  type LinkDrift,
} from './sync';

/**
 * The real thing: Drive folders and Gmail labels, pushed one way.
 *
 * Every method is a no-op when Google isn't connected or the sync scopes were
 * never granted. That keeps the app fully usable without Google — creating a
 * project must not fail because Drive is unreachable.
 */
export class LiveGoogleSync implements GoogleSync {
  private async enabled(): Promise<boolean> {
    const grant = await getGrant();
    return Boolean(grant?.refreshToken && hasSyncScopes(grant.scope));
  }

  async createProjectFolder(projectId: string, title: string): Promise<string | null> {
    if (!(await this.enabled())) return null;

    const root = await ensureFolder(ROOT);
    const container = await ensureFolder('Projects', root);
    return ensureFolder(safeName(title), container);
  }

  async createGmailLabel(projectId: string, title: string): Promise<string | null> {
    if (!(await this.enabled())) return null;

    // Gmail nests by name, so this reads "GTD/Projects/Renovate the kitchen".
    return ensureLabel(`${ROOT}/Projects/${safeName(title)}`);
  }

  async moveForStatus(
    project: {
      id: string;
      title?: string;
      completedAt?: Date | null;
      driveFolderId: string | null;
      gmailLabelId: string | null;
    },
    status: ProjectStatusLike,
  ): Promise<void> {
    if (!(await this.enabled())) return;

    const segments = containerPath(status, project.completedAt ?? null);
    const title = safeName(project.title ?? '');

    if (project.driveFolderId) {
      // Walk the chain, creating each level — Archive/2026 needs both.
      let parent = await ensureFolder(ROOT);
      for (const segment of segments) parent = await ensureFolder(segment, parent);
      await moveFile(project.driveFolderId, parent);
    }

    if (project.gmailLabelId && title) {
      // Gmail "moves" a label by renaming its path. The destination parents
      // have to exist first, or the rename produces a flat label literally
      // called "Archive/2026/Thing" instead of a nested one.
      const container = [ROOT, ...segments].join('/');
      await ensureLabel(container);
      await renameLabel(project.gmailLabelId, `${container}/${title}`);
    }
  }

  /**
   * Report drift, never fix it. The brief is explicit that this is one-way —
   * silently recreating a folder the user deleted would be the app overruling
   * a deliberate act.
   */
  async verifyLinks(): Promise<LinkDrift[]> {
    if (!(await this.enabled())) return [];

    const rows = await db
      .select({
        id: projects.id,
        title: projects.title,
        status: projects.status,
        completedAt: projects.completedAt,
        driveFolderId: projects.driveFolderId,
        gmailLabelId: projects.gmailLabelId,
      })
      .from(projects)
      .where(inArray(projects.status, ['active', 'standby', 'someday']));

    const drift: LinkDrift[] = [];

    for (const project of rows) {
      if (!project.driveFolderId && !project.gmailLabelId) {
        drift.push({
          projectId: project.id,
          projectTitle: project.title,
          issue: 'not_linked',
          detail: 'No Drive folder or Gmail label has been created yet.',
        });
        continue;
      }

      if (project.driveFolderId) {
        const file = await getFile(project.driveFolderId);
        if (!file || file.trashed) {
          drift.push({
            projectId: project.id,
            projectTitle: project.title,
            issue: 'missing_drive_folder',
            detail: file
              ? 'The Drive folder is in the bin.'
              : 'The Drive folder no longer exists.',
          });
        }
      }

      if (project.gmailLabelId) {
        const label = await getLabel(project.gmailLabelId);
        if (!label) {
          drift.push({
            projectId: project.id,
            projectTitle: project.title,
            issue: 'missing_gmail_label',
            detail: 'The Gmail label no longer exists.',
          });
        } else {
          const expected = projectLabelName(
            project.status,
            project.completedAt,
            project.title,
          );
          if (label.name !== expected) {
            drift.push({
              projectId: project.id,
              projectTitle: project.title,
              issue: 'wrong_parent',
              detail: `Label is "${label.name}", expected "${expected}".`,
            });
          }
        }
      }
    }

    return drift;
  }
}

type ProjectStatusLike = Parameters<GoogleSync['moveForStatus']>[1];
