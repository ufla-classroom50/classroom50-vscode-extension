import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

interface ExtensionConfig {
  "assignment-name": string;
  "polling-interval-minutes": number;
  "notify-from-users": string[];
  "support-links": Record<string, string>;
}

interface RepoInfo {
  org: string;
  repo: string;
}

interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string };
  path?: string;
  line?: number;
}

interface StudentRepo {
  name: string;
  username: string;
  lastCommitDate: Date;
}

function loadConfig(): ExtensionConfig | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage(
      "Classroom 50: no folder open in workspace.",
    );
    return undefined;
  }

  const configPath = path.join(
    workspaceFolders[0].uri.fsPath,
    ".c50extension.json",
  );
  if (!fs.existsSync(configPath)) {
    vscode.window.showErrorMessage(
      "Classroom 50: .c50extension.json file not found.",
    );
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as ExtensionConfig;
  } catch {
    vscode.window.showErrorMessage(
      "Classroom 50: .c50extension.json file is invalid.",
    );
    return undefined;
  }
}

function parseGitRemote(): RepoInfo | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return undefined;
  }

  try {
    const cwd = workspaceFolders[0].uri.fsPath;
    const remoteUrl = execSync("git remote get-url origin", { cwd })
      .toString()
      .trim();
    const httpsMatch = remoteUrl.match(
      /https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/,
    );
    const sshMatch = remoteUrl.match(
      /git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/,
    );
    const match = httpsMatch || sshMatch;
    if (!match) {
      vscode.window.showErrorMessage(
        "Classroom 50: could not identify the GitHub repository.",
      );
      return undefined;
    }
    return { org: match[1], repo: match[2] };
  } catch {
    vscode.window.showErrorMessage(
      "Classroom 50: open folder is not a git repository.",
    );
    return undefined;
  }
}

async function getGitHubSession(): Promise<
  vscode.AuthenticationSession | undefined
> {
  try {
    return await vscode.authentication.getSession(
      "github",
      ["repo", "read:org"],
      { createIfNone: true },
    );
  } catch {
    return undefined;
  }
}

async function getAuthenticatedUsername(
  token: string,
): Promise<string | undefined> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    return undefined;
  }
  const data = (await response.json()) as { login: string };
  return data.login;
}

async function getUserRole(
  token: string,
  org: string,
  username: string,
): Promise<string | undefined> {
  const response = await fetch(
    `https://api.github.com/orgs/${org}/memberships/${username}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    return undefined;
  }
  const data = (await response.json()) as { role: string };
  return data.role;
}

async function fetchFeedbackPR(
  token: string,
  org: string,
  repo: string,
): Promise<number | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/pulls?state=open`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    return undefined;
  }
  const pulls = (await response.json()) as Array<{
    number: number;
    title: string;
  }>;
  const feedbackPR = pulls.find((pr) => pr.title === "Feedback");
  return feedbackPR?.number;
}

async function fetchIssueComments(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<GitHubComment[]> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/issues/${prNumber}/comments`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as GitHubComment[];
}

async function fetchInlineComments(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<GitHubComment[]> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/pulls/${prNumber}/comments`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as GitHubComment[];
}

async function fetchAllComments(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<GitHubComment[]> {
  const [issueComments, inlineComments] = await Promise.all([
    fetchIssueComments(token, org, repo, prNumber),
    fetchInlineComments(token, org, repo, prNumber),
  ]);
  return [...issueComments, ...inlineComments];
}

async function fetchOrgRepos(
  token: string,
  org: string,
): Promise<Array<{ name: string }>> {
  const repos: Array<{ name: string }> = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) {
      break;
    }
    const pageRepos = (await response.json()) as Array<{ name: string }>;
    if (pageRepos.length === 0) {
      break;
    }
    repos.push(...pageRepos);
    page++;
  }

  return repos;
}

async function fetchLastCommitDate(
  token: string,
  org: string,
  repo: string,
): Promise<Date | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/commits?per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    return undefined;
  }
  const commits = (await response.json()) as Array<{
    commit: { author: { date: string } };
  }>;
  if (commits.length === 0) {
    return undefined;
  }
  return new Date(commits[0].commit.author.date);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\n/g, " ")
    .trim();
}

function formatCommentTitle(
  comment: GitHubComment,
  assignmentName: string,
): string {
  if (comment.path) {
    const fileName = comment.path.split("/").pop();
    return `💬 New feedback — ${assignmentName}\n📍 ${fileName}:${comment.line ?? "?"}`;
  }
  return `💬 New feedback — ${assignmentName}`;
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("Classroom 50 extension is now active!");

  const session = await getGitHubSession();
  if (!session) {
    vscode.window.showErrorMessage(
      "Classroom 50: could not authenticate with GitHub.",
    );
    return;
  }

  const config = loadConfig();
  if (!config) {
    return;
  }

  const repoInfo = parseGitRemote();
  if (!repoInfo) {
    return;
  }

  const token = session.accessToken;
  const { org, repo } = repoInfo;

  const username = await getAuthenticatedUsername(token);
  const role = username ? await getUserRole(token, org, username) : undefined;
  const isTeacher = true; // TEMPORÁRIO: forçando para testar como professor

  const prNumber = await fetchFeedbackPR(token, org, repo);
  if (!prNumber) {
    vscode.window.showWarningMessage("Classroom 50: feedback PR not found.");
    return;
  }

  const prUrl = `https://github.com/${org}/${repo}/pull/${prNumber}`;

  let seenCommentIds: number[] = context.globalState.get(
    `seenCommentIds_${repo}`,
    [],
  );
  let unreadComments: GitHubComment[] = context.globalState.get(
    `unreadComments_${repo}`,
    [],
  );

  const unreadStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    5000,
  );
  unreadStatusBarItem.command = "classroom50-vscode-extension.checkFeedback";
  context.subscriptions.push(unreadStatusBarItem);

  const updateUnreadStatusBar = () => {
    if (unreadComments.length > 0) {
      unreadStatusBarItem.text = `$(mail) ${unreadComments.length}`;
      unreadStatusBarItem.tooltip = `Classroom 50: ${unreadComments.length} unread feedback(s)`;
      unreadStatusBarItem.show();
    } else {
      unreadStatusBarItem.hide();
    }
  };

  const persistState = () => {
    context.globalState.update(`seenCommentIds_${repo}`, seenCommentIds);
    context.globalState.update(`unreadComments_${repo}`, unreadComments);
  };

  const checkForNewComments = async () => {
    const comments = await fetchAllComments(token, org, repo, prNumber);
    const allowedUsers = config["notify-from-users"];

    const newComments = comments.filter((c) => {
      if (seenCommentIds.includes(c.id)) {
        return false;
      }
      if (allowedUsers.length > 0 && !allowedUsers.includes(c.user.login)) {
        return false;
      }
      return true;
    });

    if (newComments.length === 0) {
      return;
    }

    for (const comment of newComments) {
      seenCommentIds.push(comment.id);
      unreadComments.push(comment);

      const preview = stripMarkdown(comment.body).substring(0, 100);
      const title = formatCommentTitle(comment, config["assignment-name"]);

      const action = await vscode.window.showInformationMessage(
        `${title}\n${preview}...`,
        "View on GitHub",
        "Mark as read",
      );

      if (action === "View on GitHub") {
        vscode.env.openExternal(vscode.Uri.parse(comment.html_url));
      } else if (action === "Mark as read") {
        unreadComments = unreadComments.filter((c) => c.id !== comment.id);
      }
    }

    persistState();
    updateUnreadStatusBar();
  };

  const showUnreadList = async () => {
    if (unreadComments.length === 0) {
      vscode.window.showInformationMessage("Classroom 50: no unread feedback.");
      return;
    }

    const items = unreadComments.map((c) => ({
      label: stripMarkdown(c.body).substring(0, 80),
      description: c.path
        ? `${c.path.split("/").pop()}:${c.line ?? "?"}`
        : undefined,
      comment: c,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a feedback to view",
    });

    if (!selected) {
      return;
    }

    const action = await vscode.window.showInformationMessage(
      stripMarkdown(selected.comment.body).substring(0, 200),
      "View on GitHub",
      "Mark as read",
    );

    if (action === "View on GitHub") {
      vscode.env.openExternal(vscode.Uri.parse(selected.comment.html_url));
    } else if (action === "Mark as read") {
      unreadComments = unreadComments.filter(
        (c) => c.id !== selected.comment.id,
      );
      persistState();
      updateUnreadStatusBar();
    }
  };

  const checkCommand = vscode.commands.registerCommand(
    "classroom50-vscode-extension.checkFeedback",
    async () => {
      await checkForNewComments();
      if (unreadComments.length > 0) {
        await showUnreadList();
      } else {
        vscode.window.showInformationMessage("Classroom 50: check completed.");
      }
    },
  );
  context.subscriptions.push(checkCommand);

  const openPRCommand = vscode.commands.registerCommand(
    "classroom50-vscode-extension.openFeedbackPR",
    () => {
      vscode.env.openExternal(vscode.Uri.parse(prUrl));
    },
  );
  context.subscriptions.push(openPRCommand);

  const openSupportLinksCommand = vscode.commands.registerCommand(
    "classroom50-vscode-extension.openSupportLinks",
    async () => {
      const links = config["support-links"];
      const linkNames = Object.keys(links || {});

      if (linkNames.length === 0) {
        vscode.window.showInformationMessage(
          "Classroom 50: no support links configured.",
        );
        return;
      }

      const selected = await vscode.window.showQuickPick(linkNames, {
        placeHolder: "Select a support material to open",
      });

      if (selected) {
        vscode.env.openExternal(vscode.Uri.parse(links[selected]));
      }
    },
  );
  context.subscriptions.push(openSupportLinksCommand);

  const checkStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    1000,
  );
  checkStatusBarItem.text = "$(bell) Check Feedback";
  checkStatusBarItem.tooltip = "Classroom 50: check for new feedback";
  checkStatusBarItem.command = "classroom50-vscode-extension.checkFeedback";
  checkStatusBarItem.show();
  context.subscriptions.push(checkStatusBarItem);

  const openPRStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    999,
  );
  openPRStatusBarItem.text = "$(git-pull-request) Feedback PR";
  openPRStatusBarItem.tooltip = "Classroom 50: open feedback PR in browser";
  openPRStatusBarItem.command = "classroom50-vscode-extension.openFeedbackPR";
  openPRStatusBarItem.show();
  context.subscriptions.push(openPRStatusBarItem);

  if (
    config["support-links"] &&
    Object.keys(config["support-links"]).length > 0
  ) {
    const supportLinksStatusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      998,
    );
    supportLinksStatusBarItem.text = "$(book) Support Materials";
    supportLinksStatusBarItem.tooltip = "Classroom 50: open support materials";
    supportLinksStatusBarItem.command =
      "classroom50-vscode-extension.openSupportLinks";
    supportLinksStatusBarItem.show();
    context.subscriptions.push(supportLinksStatusBarItem);
  }

  updateUnreadStatusBar();
  await checkForNewComments();

  const intervalMs = config["polling-interval-minutes"] * 60 * 1000;
  const timer = setInterval(checkForNewComments, intervalMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Comandos exclusivos do professor
  if (isTeacher) {
    const listStudentsCommand = vscode.commands.registerCommand(
      "classroom50-vscode-extension.listStudents",
      async () => {
        const classroomAssignment = await vscode.window.showInputBox({
          prompt:
            "Enter the classroom-assignment prefix (e.g. ppoo-2026-atividade-1)",
          placeHolder: "classroom-assignment",
        });

        if (!classroomAssignment) {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Classroom 50: fetching students...",
          },
          async () => {
            const allRepos = await fetchOrgRepos(token, org);
            const matchingRepos = allRepos.filter((r) =>
              r.name.startsWith(`${classroomAssignment}-`),
            );

            if (matchingRepos.length === 0) {
              vscode.window.showInformationMessage(
                "Classroom 50: no student repositories found.",
              );
              return;
            }

            const studentRepos: StudentRepo[] = [];
            for (const r of matchingRepos) {
              const commitDate = await fetchLastCommitDate(token, org, r.name);
              const studentUsername = r.name.replace(
                `${classroomAssignment}-`,
                "",
              );
              studentRepos.push({
                name: r.name,
                username: studentUsername,
                lastCommitDate: commitDate ?? new Date(0),
              });
            }

            studentRepos.sort(
              (a, b) => b.lastCommitDate.getTime() - a.lastCommitDate.getTime(),
            );

            const items = studentRepos.map((s) => ({
              label: s.username,
              description:
                s.lastCommitDate.getTime() > 0
                  ? s.lastCommitDate.toLocaleString()
                  : "no commits",
              repo: s.name,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: "Select a student to open their repository",
            });

            if (!selected) {
              return;
            }

            const localBasePath = path.join(
              os.homedir(),
              "classroom50-students",
              org,
            );
            const localRepoPath = path.join(localBasePath, selected.repo);

            if (fs.existsSync(localRepoPath)) {
              const folderUri = vscode.Uri.file(localRepoPath);
              await vscode.commands.executeCommand(
                "vscode.openFolder",
                folderUri,
                true,
              );
              return;
            }

            fs.mkdirSync(localBasePath, { recursive: true });

            try {
              execSync(
                `git clone https://github.com/${org}/${selected.repo}.git "${localRepoPath}"`,
                {
                  cwd: localBasePath,
                },
              );
            } catch {
              vscode.window.showErrorMessage(
                `Classroom 50: failed to clone ${selected.repo}.`,
              );
              return;
            }

            const folderUri = vscode.Uri.file(localRepoPath);
            await vscode.commands.executeCommand(
              "vscode.openFolder",
              folderUri,
              true,
            );
          },
        );
      },
    );
    context.subscriptions.push(listStudentsCommand);

    const listStudentsStatusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      997,
    );
    listStudentsStatusBarItem.text = "$(organization) List Students";
    listStudentsStatusBarItem.tooltip =
      "Classroom 50: list students and open their repositories";
    listStudentsStatusBarItem.command =
      "classroom50-vscode-extension.listStudents";
    listStudentsStatusBarItem.show();
    context.subscriptions.push(listStudentsStatusBarItem);
  }
}

export function deactivate() {}
