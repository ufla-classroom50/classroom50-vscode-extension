export interface ExtensionConfig {
  "assignment-name": string;
  "polling-interval-minutes": number;
  "notify-from-users": string[];
  "support-links": Record<string, string>;
}

export interface RepoInfo {
  org: string;
  repo: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string };
  path?: string;
  line?: number;
}

export interface TaggedComment extends GitHubComment {
  uniqueKey: string;
}

export interface StudentRepo {
  name: string;
  username: string;
  lastCommitDate: Date;
}
