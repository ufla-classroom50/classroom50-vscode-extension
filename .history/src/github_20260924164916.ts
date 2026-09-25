import {
  CONFIG_REPO_NAME,
  FEEDBACK_PR_TITLE,
  MAX_PAGES,
} from "./constants";
import {
  AssignmentRef,
  GitHubComment,
  StudentRepo,
  TaggedComment,
} from "./types";

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

export function studentRepoPrefix(classroom: string, assignment: string): string {
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

export async function fetchAdminOrgs(token: string): Promise<string[]> {
  const memberships = await request<
    Array<{ role: string; organization: { login: string } }>
  >(token, "/user/memberships/orgs?state=active&per_page=100");
  return (memberships ?? [])
    .filter((m) => m.role === "admin")
    .map((m) => m.organization.login);
}

async function fetchConfigFile<T>(
  token: string,
  org: string,
  filePath: string,
): Promise<T | undefined> {
  const file = await request<{ content: string }>(
    token,
    `/repos/${org}/${CONFIG_REPO_NAME}/contents/${filePath}`,
  );
  if (!file) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as T;
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
    "POST",
    { body },
  );
  return created !== undefined;
}