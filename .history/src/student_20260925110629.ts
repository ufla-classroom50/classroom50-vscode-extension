import * as vscode from "vscode";
import {
  ACTIONS,
  AUTOGRADER_CHECK_DELAY_MS,
  COMMANDS,
  STATUS_BAR_PRIORITY,
} from "./constants";
import { fetchAllComments } from "./github";
import {
  feedbackPRUrl,
  formatCommentLocation,
  formatCommentTitle,
  repoUrl,
  stripMarkdown,
} from "./format";
import { runSubmit } from "./submit";
import { createStatusBarButton, openInBrowser } from "./ui";
import { ExtensionConfig, RepoInfo, TaggedComment } from "./types";

class FeedbackMonitor {
  private seenKeys: string[];
  private unread: TaggedComment[];
  private isChecking = false;
  private readonly unreadItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly token: string,
    private readonly config: ExtensionConfig,
    private readonly repoInfo: RepoInfo,
    private readonly prNumber: number,
  ) {
    this.seenKeys = context.globalState.get(this.stateKey("seen"), []);
    this.unread = context.globalState.get(this.stateKey("unread"), []);

    this.unreadItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_BAR_PRIORITY.unread,
    );
    this.unreadItem.command = COMMANDS.checkFeedback;
    context.subscriptions.push(this.unreadItem);
    this.updateStatusBar();
  }

  get unreadCount(): number {
    return this.unread.length;
  }

  async check(): Promise<number> {
    if (this.isChecking) {
      return 0;
    }
    this.isChecking = true;

    try {
      const { org, repo } = this.repoInfo;
      const comments = await fetchAllComments(
        this.token,
        org,
        repo,
        this.prNumber,
      );
      const newComments = comments.filter((c) => this.shouldNotify(c));

      for (const comment of newComments) {
        this.seenKeys.push(comment.uniqueKey);
        this.unread.push(comment);
      }

      if (newComments.length > 0) {
        this.persist();
        this.updateStatusBar();
        for (const comment of newComments) {
          const preview = stripMarkdown(comment.body).substring(0, 100);
          const title = formatCommentTitle(
            comment,
            this.config["assignment-name"],
          );
          void this.promptAction(comment, `${title}\n${preview}...`);
        }
      }

      return newComments.length;
    } finally {
      this.isChecking = false;
    }
  }

  async showUnreadList(): Promise<void> {
    if (this.unread.length === 0) {
      vscode.window.showInformationMessage("Classroom 50: no unread feedback.");
      return;
    }

    const items = this.unread.map((c) => ({
      label: stripMarkdown(c.body).substring(0, 80),
      description: formatCommentLocation(c),
      comment: c,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a feedback to view",
    });

    if (selected) {
      await this.promptAction(
        selected.comment,
        stripMarkdown(selected.comment.body).substring(0, 200),
      );
    }
  }

  private shouldNotify(comment: TaggedComment): boolean {
    if (this.seenKeys.includes(comment.uniqueKey)) {
      return false;
    }
    const allowedUsers = this.config["notify-from-users"];
    return (
      allowedUsers.length === 0 || allowedUsers.includes(comment.user.login)
    );
  }

  private async promptAction(
    comment: TaggedComment,
    message: string,
  ): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      message,
      ACTIONS.viewOnGitHub,
      ACTIONS.markAsRead,
    );

    if (action === ACTIONS.viewOnGitHub) {
      openInBrowser(comment.html_url);
      this.markAsRead(comment.uniqueKey);
    } else if (action === ACTIONS.markAsRead) {
      this.markAsRead(comment.uniqueKey);
    }
  }

  private markAsRead(uniqueKey: string): void {
    this.unread = this.unread.filter((c) => c.uniqueKey !== uniqueKey);
    this.persist();
    this.updateStatusBar();
  }

  private persist(): void {
    this.context.globalState.update(this.stateKey("seen"), this.seenKeys);
    this.context.globalState.update(this.stateKey("unread"), this.unread);
  }

  private updateStatusBar(): void {
    if (this.unread.length > 0) {
      this.unreadItem.text = `$(mail) ${this.unread.length}`;
      this.unreadItem.tooltip = `Classroom 50: ${this.unread.length} unread feedback(s)`;
      this.unreadItem.show();
    } else {
      this.unreadItem.hide();
    }
  }

  private stateKey(kind: "seen" | "unread"): string {
    const prefix = kind === "seen" ? "seenCommentKeys" : "unreadComments";
    return `${prefix}_${this.repoInfo.repo}`;
  }
}

export async function registerStudentFeatures(
  context: vscode.ExtensionContext,
  token: string,
  config: ExtensionConfig,
  repoInfo: RepoInfo,
  prNumber: number,
  workspacePath: string,
): Promise<void> {
  const monitor = new FeedbackMonitor(
    context,
    token,
    config,
    repoInfo,
    prNumber,
  );
  let isSubmitting = false;

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.checkFeedback, async () => {
      const newCount = await monitor.check();
      if (newCount > 0) {
        return;
      }
      if (monitor.unreadCount > 0) {
        await monitor.showUnreadList();
      } else {
        vscode.window.showInformationMessage("Classroom 50: no new feedback.");
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openSupportLinks, () =>
      pickSupportLink(config["support-links"]),
    ),
    vscode.commands.registerCommand(COMMANDS.submitAssignment, async () => {
      if (isSubmitting) {
        return;
      }
      isSubmitting = true;
      try {
        await submitAndScheduleCheck(
          context,
          monitor,
          workspacePath,
          repoUrl(repoInfo),
        );
      } finally {
        isSubmitting = false;
      }
    }),
  );

  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.checkFeedback,
    "$(bell) Check Feedback",
    "Classroom 50: check for new feedback",
    COMMANDS.checkFeedback,
  );
  registerFeedbackPRButton(context, feedbackPRUrl(repoInfo, prNumber));
  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.submitAssignment,
    "$(cloud-upload) Submit",
    "Classroom 50: submit your work and run the autograder",
    COMMANDS.submitAssignment,
  );
  if (Object.keys(config["support-links"]).length > 0) {
    createStatusBarButton(
      context,
      STATUS_BAR_PRIORITY.supportLinks,
      "$(book) Support Materials",
      "Classroom 50: open support materials",
      COMMANDS.openSupportLinks,
    );
  }

  await vscode.commands.executeCommand(
    "setContext",
    "classroom50.isStudentRepo",
    true,
  );

  await monitor.check();

  const intervalMs = config["polling-interval-minutes"] * 60 * 1000;
  const timer = setInterval(() => void monitor.check(), intervalMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function registerFeedbackPRButton(
  context: vscode.ExtensionContext,
  prUrl: string,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openFeedbackPR, () =>
      openInBrowser(prUrl),
    ),
  );
  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.openFeedbackPR,
    "$(git-pull-request) Feedback PR",
    "Classroom 50: open feedback PR in browser",
    COMMANDS.openFeedbackPR,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "classroom50.hasFeedbackPR",
    true,
  );
}

async function submitAndScheduleCheck(
  context: vscode.ExtensionContext,
  monitor: FeedbackMonitor,
  workspacePath: string,
  repositoryUrl: string,
): Promise<void> {
  const submitted = await runSubmit(workspacePath);
  if (!submitted) {
    return;
  }

  const timeout = setTimeout(
    () => void monitor.check(),
    AUTOGRADER_CHECK_DELAY_MS,
  );
  context.subscriptions.push({ dispose: () => clearTimeout(timeout) });

  const action = await vscode.window.showInformationMessage(
    "Classroom 50: submission sent! The autograder is running — new feedback will be checked in a few minutes.",
    ACTIONS.viewAutograder,
  );
  if (action === ACTIONS.viewAutograder) {
    openInBrowser(`${repositoryUrl}/actions`);
  }
}

async function pickSupportLink(links: Record<string, string>): Promise<void> {
  const names = Object.keys(links);
  if (names.length === 0) {
    vscode.window.showInformationMessage(
      "Classroom 50: no support links configured.",
    );
    return;
  }

  const selected = await vscode.window.showQuickPick(names, {
    placeHolder: "Select a support material to open",
  });
  if (selected) {
    openInBrowser(links[selected]);
  }
}
