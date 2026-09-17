import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, execFileSync } from "child_process";

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

interface TaggedComment extends GitHubComment {
  uniqueKey: string;
}

interface StudentRepo {
  name: string;
  username: string;
  lastCommitDate: Date;
}

const MAX_PAGES = 20;

function validateConfig(data: any): string | undefined {
  if (
    typeof data["assignment-name"] !== "string" ||
    data["assignment-name"].length === 0
  ) {
    return 'missing or invalid "assignment-name"';
  }
  if (
    typeof data["polling-interval-minutes"] !== "number" ||
    data["polling-interval-minutes"] <= 0
  ) {
    return 'missing or invalid "polling-interval-minutes"';
  }
  if (!Array.isArray(data["notify-from-users"])) {
    return 'missing or invalid "notify-from-users" (must be an array)';
  }
  if (
    data["support-links"] !== undefined &&
    typeof data["support-links"] !== "object"
  ) {
    return 'invalid "support-links" (must be an object)';
  }
  return undefined;
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

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    vscode.window.showErrorMessage(
      "Classroom 50: .c50extension.json file is invalid JSON.",
    );
    return undefined;
  }

  const validationError = validateConfig(data);
  if (validationError) {
    vscode.window.showErrorMessage(
      `Classroom 50: .c50extension.json is invalid — ${validationError}.`,
    );
    return undefined;
  }

  if (data["support-links"] === undefined) {
    data["support-links"] = {};
  }

  return data as ExtensionConfig;
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
    `https://api.github.com/repos/${org}/${repo}/pulls?state=open&per_page=100`,
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
): Promise<TaggedComment[]> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/issues/${prNumber}/comments?per_page=100`,
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
  const comments = (await response.json()) as GitHubComment[];
  return comments.map((c) => ({ ...c, uniqueKey: `issue-${c.id}` }));
}

async function fetchInlineComments(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<TaggedComment[]> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/pulls/${prNumber}/comments?per_page=100`,
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
  const comments = (await response.json()) as GitHubComment[];
  return comments.map((c) => ({ ...c, uniqueKey: `review-${c.id}` }));
}

async function fetchAllComments(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
): Promise<TaggedComment[]> {
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

  while (page <= MAX_PAGES) {
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

async function fetchStudentRepos(
  token: string,
  org: string,
  classroomAssignment: string,
): Promise<StudentRepo[]> {
  const allRepos = await fetchOrgRepos(token, org);
  const matchingRepos = allRepos.filter((r) =>
    r.name.startsWith(`${classroomAssignment}-`),
  );

  const studentRepos: StudentRepo[] = [];
  for (const r of matchingRepos) {
    const commitDate = await fetchLastCommitDate(token, org, r.name);
    const studentUsername = r.name.replace(`${classroomAssignment}-`, "");
    studentRepos.push({
      name: r.name,
      username: studentUsername,
      lastCommitDate: commitDate ?? new Date(0),
    });
  }

  studentRepos.sort(
    (a, b) => b.lastCommitDate.getTime() - a.lastCommitDate.getTime(),
  );
  return studentRepos;
}

async function postComment(
  token: string,
  org: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
  return response.ok;
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

async function getMultilineText(
  placeholderText: string,
): Promise<string | undefined> {
  const tempFilePath = path.join(
    os.tmpdir(),
    `c50-announcement-${Date.now()}.md`,
  );
  fs.writeFileSync(tempFilePath, placeholderText, "utf8");

  const doc = await vscode.workspace.openTextDocument(tempFilePath);
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.window.showInformationMessage(
    "Write your announcement in the editor. Save the file (Ctrl+S) when you are done.",
  );

  await new Promise<void>((resolve) => {
    const saveDisposable = vscode.workspace.onDidSaveTextDocument(
      (savedDoc) => {
        if (savedDoc.uri.toString() === doc.uri.toString()) {
          saveDisposable.dispose();
          resolve();
        }
      },
    );
  });

  const finalText = fs.readFileSync(tempFilePath, "utf8").trim();

  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  try {
    fs.unlinkSync(tempFilePath);
  } catch {
  }

  if (finalText.length === 0 || finalText === placeholderText.trim()) {
    return undefined;
  }

  return finalText;
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
  const isTeacher = role === "admin";

  const prNumber = await fetchFeedbackPR(token, org, repo);
  if (!prNumber) {
    vscode.window.showWarningMessage("Classroom 50: feedback PR not found.");
    return;
  }

  const prUrl = `https://github.com/${org}/${repo}/pull/${prNumber}`;

  let seenCommentKeys: string[] = context.globalState.get(
    `seenCommentKeys_${repo}`,
    [],
  );
  let unreadComments: TaggedComment[] = context.globalState.get(
    `unreadComments_${repo}`,
    [],
  );

  const unreadStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    2000,
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
    context.globalState.update(`seenCommentKeys_${repo}`, seenCommentKeys);
    context.globalState.update(`unreadComments_${repo}`, unreadComments);
  };

  let isChecking = false;

  const checkForNewComments = async () => {
    if (isChecking) {
      return;
    }
    isChecking = true;

    try {
      const comments = await fetchAllComments(token, org, repo, prNumber);
      const allowedUsers = config["notify-from-users"];

      const newComments = comments.filter((c) => {
        if (seenCommentKeys.includes(c.uniqueKey)) {
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
        seenCommentKeys.push(comment.uniqueKey);
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
          unreadComments = unreadComments.filter(
            (c) => c.uniqueKey !== comment.uniqueKey,
          );
        }
      }

      persistState();
      updateUnreadStatusBar();
    } catch (err) {
      console.error("Classroom 50: error checking for new comments", err);
    } finally {
      isChecking = false;
    }
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
        (c) => c.uniqueKey !== selected.comment.uniqueKey,
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
    1999,
  );
  checkStatusBarItem.text = "$(bell) Check Feedback";
  checkStatusBarItem.tooltip = "Classroom 50: check for new feedback";
  checkStatusBarItem.command = "classroom50-vscode-extension.checkFeedback";
  checkStatusBarItem.show();
  context.subscriptions.push(checkStatusBarItem);

  const openPRStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    1998,
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
      1997,
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
            const studentRepos = await fetchStudentRepos(
              token,
              org,
              classroomAssignment,
            );

            if (studentRepos.length === 0) {
              vscode.window.showInformationMessage(
                "Classroom 50: no student repositories found.",
              );
              return;
            }

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
              execFileSync(
                "git",
                [
                  "clone",
                  `https://github.com/${org}/${selected.repo}.git`,
                  localRepoPath,
                ],
                { cwd: localBasePath },
              );
            } catch (err) {
              console.error("Classroom 50: git clone failed", err);
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
      1996,
    );
    listStudentsStatusBarItem.text = "$(organization) List Students";
    listStudentsStatusBarItem.tooltip =
      "Classroom 50: list students and open their repositories";
    listStudentsStatusBarItem.command =
      "classroom50-vscode-extension.listStudents";
    listStudentsStatusBarItem.show();
    context.subscriptions.push(listStudentsStatusBarItem);

    const sendAnnouncementCommand = vscode.commands.registerCommand(
      "classroom50-vscode-extension.sendAnnouncement",
      async () => {
        const classroomAssignment = await vscode.window.showInputBox({
          prompt:
            "Enter the classroom-assignment prefix (e.g. ppoo-2026-atividade-1)",
          placeHolder: "classroom-assignment",
        });

        if (!classroomAssignment) {
          return;
        }

        const studentRepos = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Classroom 50: fetching students...",
          },
          async () => fetchStudentRepos(token, org, classroomAssignment),
        );

        if (studentRepos.length === 0) {
          vscode.window.showInformationMessage(
            "Classroom 50: no student repositories found.",
          );
          return;
        }

        const items = studentRepos.map((s) => ({
          label: s.username,
          description:
            s.lastCommitDate.getTime() > 0
              ? s.lastCommitDate.toLocaleString()
              : "no commits",
          repo: s.name,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder:
            "Select the students who should receive the announcement",
          canPickMany: true,
        });

        if (!selected || selected.length === 0) {
          return;
        }

        const announcementText = await getMultilineText(
          "<!-- Write your announcement below. Do not delete this line. -->\n",
        );

        if (!announcementText) {
          vscode.window.showInformationMessage(
            "Classroom 50: announcement cancelled.",
          );
          return;
        }

        const cleanText = announcementText
          .replace(
            "<!-- Write your announcement below. Do not delete this line. -->",
            "",
          )
          .trim();

        if (cleanText.length === 0) {
          vscode.window.showInformationMessage(
            "Classroom 50: announcement is empty, cancelled.",
          );
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `You are about to send this announcement to ${selected.length} student(s). Continue?`,
          { modal: true },
          "Send",
        );

        if (confirm !== "Send") {
          return;
        }

        const failedStudents: string[] = [];

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Classroom 50: sending announcement",
            cancellable: false,
          },
          async (progress) => {
            for (let i = 0; i < selected.length; i++) {
              const student = selected[i];
              progress.report({
                message: `${i + 1}/${selected.length} — ${student.label}`,
                increment: 100 / selected.length,
              });

              const studentPrNumber = await fetchFeedbackPR(
                token,
                org,
                student.repo,
              );
              if (!studentPrNumber) {
                failedStudents.push(student.label);
                continue;
              }

              const success = await postComment(
                token,
                org,
                student.repo,
                studentPrNumber,
                cleanText,
              );
              if (!success) {
                failedStudents.push(student.label);
              }
            }
          },
        );

        if (failedStudents.length === 0) {
          vscode.window.showInformationMessage(
            `Classroom 50: announcement sent to all ${selected.length} student(s).`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Classroom 50: announcement sent, but failed for: ${failedStudents.join(", ")}.`,
          );
        }
      },
    );
    context.subscriptions.push(sendAnnouncementCommand);

    const sendAnnouncementStatusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1995,
    );
    sendAnnouncementStatusBarItem.text = "$(megaphone) Send Announcement";
    sendAnnouncementStatusBarItem.tooltip =
      "Classroom 50: send announcement to selected students";
    sendAnnouncementStatusBarItem.command =
      "classroom50-vscode-extension.sendAnnouncement";
    sendAnnouncementStatusBarItem.show();
    context.subscriptions.push(sendAnnouncementStatusBarItem);
  }
}

export function deactivate() {}
