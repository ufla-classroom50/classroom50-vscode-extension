import {
  FEEDBACK_PR_TITLE,
  MAX_PAGES,
} from "./constants";
import { GitHubComment, StudentRepo, TaggedComment } from "./types";

const GITHUB_API_URL = "https://api.github.com";

async function request<T>(
  token: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T | undefined> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(`${GITHUB_API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      console.error(
        `Classroom 50: ${method} ${path} failed with status ${response.status}`,
      );
      return undefined;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.error(`Classroom 50: ${method} ${path} failed`, err);
    return undefined;
  }
}

export async function getAuthenticatedUsername(
  token: string,
): Promise<string | undefined> {
  const user = await request<{ login: string }>(token, "/user");
  return user?.login;
}

export async function getUserRole(
  token: string,
  org: string,
  username: string,
): Promise<string | undefined> {
  const membership = await request<{ role: string }>(
    token,
    `/orgs/${org}/memberships/${username}`,
  );
  return membership?.role;
}

export async function fetchFeedbackPR(
  token: string,
  org: string,
  repo: string,
): Promise<number | undefined> {
  const pulls = await request<Array<{ number: number; title: string }>>(
    token,
    `/repos/${org}/${repo}/pulls?state=open&per_page=100`,
  );
  return pulls?.find((pr) => pr.title === FEEDBACK_PR_TITLE)?.number;
}

async function fetchCommentsFrom(
  token: string,
  path: string,
  keyPrefix: string,
): Promise<TaggedComment[]> {
  const comments = await request<GitHubComment[]>(token, path);
  return (comments ?? []).map((c) => ({
    ...c,
    uniqueKey: `${keyPrefix}-${c.id}`,
  }));
}

export async function fetchAllComments(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<TaggedComment[]> {
  const [issueComments, reviewComments] = await Promise.all([
    fetchCommentsFrom(
      token,
      `/repos/${org}/${repo}/issues/${prNumber}/comments?per_page=100`,
      "issue",
    ),
    fetchCommentsFrom(
      token,
      `/repos/${org}/${repo}/pulls/${prNumber}/comments?per_page=100`,
      "review",
    ),
  ]);
  return [...issueComments, ...reviewComments];
}

async function fetchOrgRepos(
  token: string,
  org: string,
): Promise<Array<{ name: string }>> {
  const repos: Array<{ name: string }> = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageRepos = await request<Array<{ name: string }>>(
      token,
      `/orgs/${org}/repos?per_page=100&page=${page}`,
    );
    if (!pageRepos || pageRepos.length === 0) {
      break;
    }
    repos.push(...pageRepos);
  }

  return repos;
}

async function fetchLastCommitDate(
  token: string,
  org: string,
  repo: string,
): Promise<Date | undefined> {
  const commits = await request<Array<{ commit: { author: { date: string } } }>>(
    token,
    `/repos/${org}/${repo}/commits?per_page=1`,
  );
  if (!commits || commits.length === 0) {
    return undefined;
  }
  return new Date(commits[0].commit.author.date);
}

export async function fetchStudentRepos(
  token: string,
  org: string,
  classroomAssignment: string,
): Promise<StudentRepo[]> {
  const prefix = `${classroomAssignment}-`;
  const allRepos = await fetchOrgRepos(token, org);
  const matchingRepos = allRepos.filter((r) => r.name.startsWith(prefix));

  const studentRepos = await Promise.all(
    matchingRepos.map(async (r) => ({
      name: r.name,
      username: r.name.slice(prefix.length),
      lastCommitDate:
        (await fetchLastCommitDate(token, org, r.name)) ?? new Date(0),
    })),
  );

  return studentRepos.sort(
    (a, b) => b.lastCommitDate.getTime() - a.lastCommitDate.getTime(),
  );
}

export async function postComment(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<boolean> {
  const created = await request<{ id: number }>(
    token,
    `/repos/${org}/${repo}/issues/${prNumber}/comments`,
    "POST",
    { body },
  );
  return created !== undefined;
}