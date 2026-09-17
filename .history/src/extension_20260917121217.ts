import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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
    return await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
  } catch {
    return undefined;
  }
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

async function fetchAllComments(
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

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\n/g, " ")
    .trim();
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
    1001,
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

      const action = await vscode.window.showInformationMessage(
        `💬 New feedback — ${config["assignment-name"]}\n${preview}...`,
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
}

export function deactivate() {}
