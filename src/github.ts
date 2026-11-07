/**
 * GitHub REST API service.
 *
 * Every network call of the extension goes through this module, so the feature
 * modules never build HTTP requests themselves. If the API changes, only this
 * file needs to change.
 */

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

/**
 * Single entry point for GitHub REST API calls.
 *
 * Errors never throw: a failed request is logged and returns `undefined`, so
 * callers decide what an absent result means (e.g. "not a teacher", "no PR").
 *
 * @param options.notFoundIsExpected skips the error log for a 404 that is a
 *   normal answer, such as checking whether a repository exists.
 */
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

/**
 * Whether the user is an active admin (Owner) of the organization. In an
 * assignment repository, admins are treated as teachers.
 */
export async function isOrgAdmin(token: string, org: string): Promise<boolean> {
  const membership = await request<{ role: string; state: string }>(
    token,
    `/user/memberships/orgs/${org}`,
    { notFoundIsExpected: true },
  );
  return membership?.role === "admin" && membership.state === "active";
}

/**
 * Finds the Feedback Pull Request that Classroom 50 opens in every student
 * repository. The title "Feedback" is fixed by Classroom 50.
 *
 * @returns the PR number, or `undefined` when there is no open Feedback PR.
 */
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

/**
 * Reads every page of a list endpoint (100 items per page, at most MAX_PAGES).
 *
 * @returns all items, or `undefined` when the first page fails, so a network
 *   error is not mistaken for "no comments".
 */
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

// Raw shapes of the GitHub API responses (only the fields we use).
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

/**
 * Collects the feedback of a Feedback PR, grouped the way the teacher wrote it.
 *
 * GitHub stores PR feedback in three places:
 * - issue comments: general comments in the PR conversation;
 * - reviews: the general text written in "Review changes";
 * - review comments: comments on a specific line of code.
 *
 * Every line comment belongs to a review (`pull_request_review_id`), so each
 * review becomes ONE feedback with its text and its line comments. This is
 * why the student gets one notification per review instead of one per line.
 * Reviews with no text and no line comments are ignored.
 *
 * `legacyKeys` keeps the keys used by the previous version (one per line
 * comment), so feedback already seen before the update is not notified again.
 *
 * @returns feedback sorted from newest to oldest, or `undefined` on API errors.
 */
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

/** Lists every repository of the organization (all pages). */
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

/** Date of the most recent commit, used to sort students by activity. */
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

/**
 * Classroom 50 names student repositories `<classroom>-<assignment>-<username>`
 * in lowercase (confirmed in the Classroom 50 source code). This prefix finds
 * every student of an assignment and builds the student's own repository name.
 */
export function studentRepoPrefix(
  classroom: string,
  assignment: string,
): string {
  return `${classroom.toLowerCase()}-${assignment.toLowerCase()}-`;
}

/**
 * Lists the student repositories of an assignment for the Teacher sidebar,
 * sorted by the most recent commit, so the teacher sees who is working.
 */
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

/** Organizations where the user is an active admin. */
async function fetchAdminOrgs(token: string): Promise<string[]> {
  const memberships = await request<
    Array<{ role: string; organization: { login: string } }>
  >(token, "/user/memberships/orgs?state=active&per_page=100");
  return (memberships ?? [])
    .filter((m) => m.role === "admin")
    .map((m) => m.organization.login);
}

/** Whether the organization has the `classroom50` configuration repository. */
async function hasConfigRepo(token: string, org: string): Promise<boolean> {
  const repo = await request<{ id: number }>(
    token,
    `/repos/${org}/${CONFIG_REPO_NAME}`,
    { notFoundIsExpected: true },
  );
  return repo !== undefined;
}

/**
 * Organizations where the user is a teacher: admin of an organization that
 * has the `classroom50` repository. This follows Classroom 50's own rule and
 * needs no extra registration.
 */
export async function fetchTeacherOrgs(token: string): Promise<string[]> {
  const adminOrgs = await fetchAdminOrgs(token);
  const checked = await Promise.all(
    adminOrgs.map(async (org) =>
      (await hasConfigRepo(token, org)) ? org : undefined,
    ),
  );
  return checked.filter((org): org is string => org !== undefined);
}

/**
 * Reads a JSON file from the `classroom50` configuration repository through the
 * contents API (base64). Only teachers have access to this repository.
 */
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

/**
 * Lists the assignments of every classroom of the organization for the Teacher
 * sidebar. Each top-level folder of the `classroom50` repository is a classroom
 * with `classroom.json` (name) and `assignments.json` (assignments).
 */
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

/**
 * Posts a comment on a PR (PRs are issues in the GitHub API). Used to deliver
 * teacher announcements through the Feedback PR, which the student's extension
 * already watches.
 */
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

/** Login of the signed-in user, used to build the student's repository name. */
export async function fetchUserLogin(
  token: string,
): Promise<string | undefined> {
  const user = await request<{ login: string }>(token, "/user");
  return user?.login;
}

/** Whether the repository exists (and is visible), i.e. the assignment was accepted. */
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

/**
 * Reads a file that Classroom 50 publishes on the organization's GitHub Pages
 * (`https://<org>.github.io/classroom50/...`). These files are public, so
 * students can read them without access to the private configuration repository.
 */
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

/**
 * Discovers the student's classrooms and assignments without access to the
 * `classroom50` repository:
 * 1. Classroom 50 adds each student to a team named `classroom50-<classroom>`,
 *    so the user's teams reveal the classrooms.
 * 2. For each candidate, the public `assignments.json` lists the assignments.
 *    Staff teams (`classroom50-<classroom>-teacher`, ...) have no such file and
 *    are skipped naturally.
 *
 * Only individual assignments are returned; group assignments use other
 * repository names.
 */
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
