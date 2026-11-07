import { CONFIG_REPO_NAME, FEEDBACK_PR_TITLE, MAX_PAGES } from "./constants";
import {
  AssignmentRef,
  Feedback,
  StudentClassroom,
  StudentRepo,
} from "./types";

const GITHUB_API_URL = "https://api.github.com";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  notFoundIsExpected?: boolean;
}

async function request<T>(
  token: string,
  path: string,
  options: RequestOptions = {},
): Promise<T | undefined> {
  const { method = "GET", body, notFoundIsExpected = false } = options;
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
      if (!(notFoundIsExpected && response.status === 404)) {
        console.error(
          `Classroom 50: ${method} ${path} failed with status ${response.status}`,
        );
      }
      return undefined;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.error(`Classroom 50: ${method} ${path} failed`, err);
    return undefined;
  }
}

export async function isOrgAdmin(token: string, org: string): Promise<boolean> {
  const membership = await request<{ role: string; state: string }>(
    token,
    `/user/memberships/orgs/${org}`,
    { notFoundIsExpected: true },
  );
  return membership?.role === "admin" && membership.state === "active";
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

async function requestAllPages<T>(
  token: string,
  path: string,
): Promise<T[] | undefined> {
  const items: T[] = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageItems = await request<T[]>(
      token,
      `${path}${separator}per_page=100&page=${page}`,
    );
    if (!pageItems) {
      return page === 1 ? undefined : items;
    }
    items.push(...pageItems);
    if (pageItems.length < 100) {
      break;
    }
  }

  return items;
}

interface RawUser {
  login: string;
  avatar_url?: string;
}

interface RawIssueComment {
  id: number;
  body: string | null;
  html_url: string;
  user: RawUser | null;
  created_at: string;
}

interface RawReview {
  id: number;
  body: string | null;
  html_url: string;
  user: RawUser | null;
  submitted_at?: string;
}

interface RawReviewComment {
  id: number;
  body: string | null;
  html_url: string;
  path: string;
  line?: number | null;
  original_line?: number | null;
  pull_request_review_id: number | null;
}

export async function fetchFeedback(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<Feedback[] | undefined> {
  const base = `/repos/${org}/${repo}`;
  const [issueComments, reviews, reviewComments] = await Promise.all([
    requestAllPages<RawIssueComment>(
      token,
      `${base}/issues/${prNumber}/comments`,
    ),
    requestAllPages<RawReview>(token, `${base}/pulls/${prNumber}/reviews`),
    requestAllPages<RawReviewComment>(
      token,
      `${base}/pulls/${prNumber}/comments`,
    ),
  ]);
  if (!issueComments || !reviews || !reviewComments) {
    return undefined;
  }

  const fromComments: Feedback[] = issueComments
    .filter((c) => (c.body ?? "").trim().length > 0)
    .map((c) => ({
      key: `issue-${c.id}`,
      legacyKeys: [],
      author: c.user?.login ?? "unknown",
      avatarUrl: c.user?.avatar_url,
      createdAt: c.created_at,
      body: c.body ?? "",
      url: c.html_url,
      inline: [],
    }));

  const fromReviews: Feedback[] = reviews
    .map((review) => {
      const comments = reviewComments.filter(
        (c) => c.pull_request_review_id === review.id,
      );
      return {
        key: `pr-review-${review.id}`,
        legacyKeys: comments.map((c) => `review-${c.id}`),
        author: review.user?.login ?? "unknown",
        avatarUrl: review.user?.avatar_url,
        createdAt: review.submitted_at ?? "",
        body: review.body ?? "",
        url: review.html_url,
        inline: comments.map((c) => ({
          path: c.path,
          line: c.line ?? c.original_line ?? undefined,
          body: c.body ?? "",
          url: c.html_url,
        })),
      };
    })
    .filter((f) => f.body.trim().length > 0 || f.inline.length > 0);

  return [...fromComments, ...fromReviews].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
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
  const commits = await request<
    Array<{ commit: { author: { date: string } } }>
  >(token, `/repos/${org}/${repo}/commits?per_page=1`);
  if (!commits || commits.length === 0) {
    return undefined;
  }
  return new Date(commits[0].commit.author.date);
}

export function studentRepoPrefix(
  classroom: string,
  assignment: string,
): string {
  return `${classroom.toLowerCase()}-${assignment.toLowerCase()}-`;
}

export async function fetchStudentRepos(
  token: string,
  org: string,
  assignment: AssignmentRef,
): Promise<StudentRepo[]> {
  const prefix = studentRepoPrefix(assignment.classroom, assignment.slug);
  const allRepos = await fetchOrgRepos(token, org);
  const matchingRepos = allRepos.filter((r) =>
    r.name.toLowerCase().startsWith(prefix),
  );

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

async function fetchAdminOrgs(token: string): Promise<string[]> {
  const memberships = await request<
    Array<{ role: string; organization: { login: string } }>
  >(token, "/user/memberships/orgs?state=active&per_page=100");
  return (memberships ?? [])
    .filter((m) => m.role === "admin")
    .map((m) => m.organization.login);
}

async function hasConfigRepo(token: string, org: string): Promise<boolean> {
  const repo = await request<{ id: number }>(
    token,
    `/repos/${org}/${CONFIG_REPO_NAME}`,
    { notFoundIsExpected: true },
  );
  return repo !== undefined;
}

export async function fetchTeacherOrgs(token: string): Promise<string[]> {
  const adminOrgs = await fetchAdminOrgs(token);
  const checked = await Promise.all(
    adminOrgs.map(async (org) =>
      (await hasConfigRepo(token, org)) ? org : undefined,
    ),
  );
  return checked.filter((org): org is string => org !== undefined);
}

async function fetchConfigFile<T>(
  token: string,
  org: string,
  filePath: string,
): Promise<T | undefined> {
  const file = await request<{ content: string }>(
    token,
    `/repos/${org}/${CONFIG_REPO_NAME}/contents/${filePath}`,
    { notFoundIsExpected: true },
  );
  if (!file) {
    return undefined;
  }
  try {
    return JSON.parse(
      Buffer.from(file.content, "base64").toString("utf8"),
    ) as T;
  } catch (err) {
    console.error(`Classroom 50: could not parse ${filePath}`, err);
    return undefined;
  }
}

export async function fetchOrgAssignments(
  token: string,
  org: string,
): Promise<AssignmentRef[]> {
  const entries = await request<Array<{ name: string; type: string }>>(
    token,
    `/repos/${org}/${CONFIG_REPO_NAME}/contents`,
  );
  const directories = (entries ?? []).filter(
    (e) => e.type === "dir" && !e.name.startsWith("."),
  );

  const perClassroom = await Promise.all(
    directories.map(async (dir) => {
      const classroom = await fetchConfigFile<{ name: string }>(
        token,
        org,
        `${dir.name}/classroom.json`,
      );
      if (!classroom) {
        return [];
      }
      const manifest = await fetchConfigFile<{
        assignments: Array<{ slug: string; name: string }>;
      }>(token, org, `${dir.name}/assignments.json`);

      return (manifest?.assignments ?? []).map((a) => ({
        classroom: dir.name,
        classroomName: classroom.name,
        slug: a.slug,
        name: a.name,
      }));
    }),
  );

  return perClassroom.flat();
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
    { method: "POST", body: { body } },
  );
  return created !== undefined;
}

export async function fetchUserLogin(
  token: string,
): Promise<string | undefined> {
  const user = await request<{ login: string }>(token, "/user");
  return user?.login;
}

export async function repoExists(
  token: string,
  org: string,
  repo: string,
): Promise<boolean> {
  const found = await request<{ id: number }>(token, `/repos/${org}/${repo}`, {
    notFoundIsExpected: true,
  });
  return found !== undefined;
}

async function fetchPublishedConfig<T>(
  org: string,
  filePath: string,
): Promise<T | undefined> {
  const url = `https://${org.toLowerCase()}.github.io/${CONFIG_REPO_NAME}/${filePath}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.error(`Classroom 50: GET ${url} failed`, err);
    return undefined;
  }
}

export async function fetchStudentClassrooms(
  token: string,
): Promise<StudentClassroom[]> {
  const teams = await request<
    Array<{ slug: string; organization: { login: string } }>
  >(token, "/user/teams?per_page=100");
  const teamPrefix = `${CONFIG_REPO_NAME}-`;
  const candidates = (teams ?? []).filter((t) => t.slug.startsWith(teamPrefix));

  const classrooms = await Promise.all(
    candidates.map(async (team) => {
      const org = team.organization.login;
      const classroom = team.slug.slice(teamPrefix.length);
      const manifest = await fetchPublishedConfig<{
        assignments?: Array<{ slug: string; name: string; mode?: string }>;
      }>(org, `${classroom}/assignments.json`);
      if (!manifest) {
        return undefined;
      }
      const info = await fetchPublishedConfig<{ name?: string }>(
        org,
        `${classroom}/classroom.json`,
      );
      return {
        org,
        classroom,
        classroomName: info?.name ?? classroom,
        assignments: (manifest.assignments ?? [])
          .filter((a) => (a.mode ?? "individual") === "individual")
          .map((a) => ({ slug: a.slug, name: a.name })),
      };
    }),
  );

  return classrooms
    .filter((c): c is StudentClassroom => c !== undefined)
    .sort(
      (a, b) =>
        a.org.localeCompare(b.org) ||
        a.classroomName.localeCompare(b.classroomName),
    );
}
