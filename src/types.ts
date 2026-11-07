export interface ExtensionConfig {
  "assignment-name": string;
  "polling-interval-minutes": number;
  "notify-from-users": string[];
  "support-links": Record<string, string>;
  autograder: boolean;
}

export interface RepoInfo {
  org: string;
  repo: string;
}

export interface InlineComment {
  path: string;
  line?: number;
  body: string;
  url: string;
}

export interface Feedback {
  key: string;
  legacyKeys: string[];
  author: string;
  avatarUrl?: string;
  createdAt: string;
  body: string;
  url: string;
  inline: InlineComment[];
}

export interface StudentRepo {
  name: string;
  username: string;
  lastCommitDate: Date;
}

export interface AssignmentRef {
  classroom: string;
  classroomName: string;
  slug: string;
  name: string;
}

export interface StudentClassroom {
  org: string;
  classroom: string;
  classroomName: string;
  assignments: Array<{ slug: string; name: string }>;
}
