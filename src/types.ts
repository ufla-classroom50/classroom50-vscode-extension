/**
 * Types shared by the modules.
 */

/** Contents of `.c50extension.json` after validation. */
export interface ExtensionConfig {
  "assignment-name": string;
  "polling-interval-minutes": number;
  "notify-from-users": string[];
  "support-links": Record<string, string>;
  autograder: boolean;
}

/** Organization and repository, taken from the git remote. */
export interface RepoInfo {
  org: string;
  repo: string;
}

/** A comment on a specific line of code, inside a review. */
export interface InlineComment {
  path: string;
  line?: number;
  body: string;
  url: string;
}

/**
 * One feedback item as the student sees it: a general PR comment, or a review
 * with its general text and its line comments.
 */
export interface Feedback {
  key: string;
// Keys used by previous versions for the same comments (migration only).
  legacyKeys: string[];
  author: string;
  avatarUrl?: string;
  createdAt: string;
  body: string;
  url: string;
  inline: InlineComment[];
}

/** A student repository in the Teacher sidebar. */
export interface StudentRepo {
  name: string;
  username: string;
  lastCommitDate: Date;
}

/** An assignment of a classroom, as read from the configuration repository. */
export interface AssignmentRef {
  classroom: string;
  classroomName: string;
  slug: string;
  name: string;
}

/** A classroom of the student, with its individual assignments. */
export interface StudentClassroom {
  org: string;
  classroom: string;
  classroomName: string;
  assignments: Array<{ slug: string; name: string }>;
}
