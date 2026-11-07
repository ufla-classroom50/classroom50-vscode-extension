/**
 * Student features inside an assignment repository.
 *
 * The integration point with teachers and autograders is the Feedback PR: any
 * comment or review posted there (by a person or by a bot such as
 * github-actions[bot]) becomes a notification. The extension does not depend
 * on a specific autograder; it only reads the PR.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ACTIONS,
  AUTOGRADER_CHECK_DELAY_MS,
  COMMANDS,
  STATUS_BAR_PRIORITY,
} from "./constants";
import { FeedbackPanel } from "./feedbackPanel";
import { fetchFeedback } from "./github";
import { feedbackPRUrl, formatFeedbackMessage, repoUrl } from "./format";
import { SyncResult, syncAfterSubmit } from "./gitsync";
import { setFeedbackBadge } from "./studentView";
import { SupportPanel } from "./supportPanel";
import { runSubmit } from "./submit";
import { createStatusBarButton, openInBrowser } from "./ui";
import { ExtensionConfig, Feedback, RepoInfo } from "./types";
import { t } from "./i18n";

// Above this many new feedback items at once, a single summary notification
// is shown instead of one per item.
const MAX_INDIVIDUAL_TOASTS = 3;

/**
 * Watches the Feedback PR of the open assignment and keeps the student informed.
 *
 * State saved per repository in VS Code's globalState (survives restarts):
 * - seen keys: every feedback ever detected, so nothing is notified twice;
 * - unread keys: feedback the student has not marked as read yet;
 * - cache: the last list of feedback, so the panel opens instantly.
 *
 * The history is local to each VS Code installation: on another computer, old
 * feedback appears again as unread (a known, accepted limitation).
 */
class FeedbackMonitor {
  private readonly seenKeys: Set<string>;
  private readonly unreadKeys: Set<string>;
  private feedback: Feedback[];
// Unread comments saved by the previous version, migrated on the first check.
  private legacyUnreadKeys: Set<string>;
  private isChecking = false;
  private readonly feedbackItem: vscode.StatusBarItem;
  private readonly panel: FeedbackPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly token: string,
    private readonly config: ExtensionConfig,
    private readonly repoInfo: RepoInfo,
    private readonly prNumber: number,
    private readonly workspacePath: string,
  ) {
    const state = context.globalState;
    this.seenKeys = new Set(state.get<string[]>(this.stateKey("seen"), []));
    this.unreadKeys = new Set(state.get<string[]>(this.stateKey("unread"), []));
    this.feedback = state.get<Feedback[]>(this.stateKey("cache"), []);
    this.legacyUnreadKeys = new Set(
      state
        .get<Array<{ uniqueKey: string }>>(this.stateKey("legacyUnread"), [])
        .map((c) => c.uniqueKey),
    );

    this.panel = new FeedbackPanel(t("Feedback — {0}", config["assignment-name"]), {
      markAsRead: (key) => this.markAsRead(key),
      markAllAsRead: () => this.markAllAsRead(),
      openOnGitHub: (key, index) => this.openOnGitHub(key, index),
      openInlineFile: (key, index) => void this.openInlineFile(key, index),
    });
    context.subscriptions.push({ dispose: () => this.panel.dispose() });

    this.feedbackItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_BAR_PRIORITY.unread,
    );
    this.feedbackItem.command = COMMANDS.openFeedback;
    this.feedbackItem.show();
    context.subscriptions.push(this.feedbackItem);
    this.updateIndicators();
  }

  get unreadCount(): number {
    return this.unreadKeys.size;
  }

/**
 * Fetches the feedback and notifies the new items.
 *
 * Polling (run every `polling-interval-minutes`, on "Check Feedback" and after
 * a submit) was chosen over GitHub webhooks: webhooks would need a public
 * server to receive events, while polling runs entirely on the student's
 * computer. The `isChecking` flag avoids overlapping checks.
 *
 * @returns how many new feedback items were found.
 */
  async check(): Promise<number> {
    if (this.isChecking) {
      return 0;
    }
    this.isChecking = true;

    try {
      const { org, repo } = this.repoInfo;
      const fetched = await fetchFeedback(this.token, org, repo, this.prNumber);
      if (!fetched) {
        return 0;
      }

      const allowedUsers = this.config["notify-from-users"];
      this.feedback = fetched.filter(
        (f) => allowedUsers.length === 0 || allowedUsers.includes(f.author),
      );

      const newFeedback: Feedback[] = [];
      for (const item of this.feedback) {
        if (this.wasSeen(item)) {
          if (this.wasLegacyUnread(item)) {
            this.unreadKeys.add(item.key);
          }
        } else {
          newFeedback.push(item);
          this.unreadKeys.add(item.key);
        }
        this.seenKeys.add(item.key);
        item.legacyKeys.forEach((k) => this.seenKeys.add(k));
      }
      this.legacyUnreadKeys.clear();

      this.persist();
      this.updateIndicators();
      await this.panel.update(this.feedback, this.unreadKeys);
      this.announce(newFeedback);

      return newFeedback.length;
    } finally {
      this.isChecking = false;
    }
  }

  async openPanel(): Promise<void> {
    await this.panel.show(this.feedback, this.unreadKeys);
  }

// A review counts as seen if its key was seen, or if all of its line comments
// were seen by the previous version (which stored one key per line comment).
  private wasSeen(item: Feedback): boolean {
    if (this.seenKeys.has(item.key)) {
      return true;
    }
    return (
      item.legacyKeys.length > 0 &&
      item.legacyKeys.every((k) => this.seenKeys.has(k))
    );
  }

  private wasLegacyUnread(item: Feedback): boolean {
    return [item.key, ...item.legacyKeys].some((k) =>
      this.legacyUnreadKeys.has(k),
    );
  }

  private announce(newFeedback: Feedback[]): void {
    if (newFeedback.length === 0) {
      return;
    }
    if (newFeedback.length > MAX_INDIVIDUAL_TOASTS) {
      void this.promptAction(
        undefined,
        t(
          "💬 {0} new feedback items — {1}",
          newFeedback.length,
          this.config["assignment-name"],
        ),
      );
      return;
    }
    for (const item of newFeedback) {
      void this.promptAction(
        item,
        formatFeedbackMessage(item, this.config["assignment-name"]),
      );
    }
  }

/**
 * Shows the notification of a new feedback item. VS Code hides information
 * notifications about 10 seconds after they appear, and extensions cannot
 * change that, so the notification is only the alert: the feedback stays in
 * the panel, in the highlighted status bar item and in the sidebar badge
 * until the student marks it as read.
 */
  private async promptAction(
    item: Feedback | undefined,
    message: string,
  ): Promise<void> {
    const actions: string[] = [t(ACTIONS.openFeedback)];
    if (item) {
      actions.push(t(ACTIONS.viewOnGitHub));
    }
    const action = await vscode.window.showInformationMessage(
      message,
      ...actions,
    );

    if (action === t(ACTIONS.openFeedback)) {
      await this.openPanel();
    } else if (action === t(ACTIONS.viewOnGitHub) && item) {
      this.openOnGitHub(item.key);
    }
  }

  private find(key: string): Feedback | undefined {
    return this.feedback.find((f) => f.key === key);
  }

// Opening the feedback on GitHub also counts as reading it.
  private openOnGitHub(key: string, inlineIndex?: number): void {
    const item = this.find(key);
    if (!item) {
      return;
    }
    const url =
      inlineIndex !== undefined ? item.inline[inlineIndex]?.url : item.url;
    if (url) {
      openInBrowser(url);
    }
    this.markAsRead(key);
  }

/**
 * Opens the file of a line comment at the commented line. The path comes from
 * GitHub, so it is resolved inside the workspace and rejected if it points
 * outside of it (e.g. "../").
 */
  private async openInlineFile(key: string, index: number): Promise<void> {
    const comment = this.find(key)?.inline[index];
    if (!comment) {
      return;
    }
    const root = path.resolve(this.workspacePath);
    const filePath = path.resolve(root, comment.path);
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
      vscode.window.showWarningMessage(
        t("Classroom 50: {0} was not found in this folder.", comment.path),
      );
      return;
    }
    const line = Math.max((comment.line ?? 1) - 1, 0);
    const position = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Range(position, position),
    });
  }

  private markAsRead(key: string): void {
    if (!this.unreadKeys.delete(key)) {
      return;
    }
    this.afterReadChange();
  }

  private markAllAsRead(): void {
    if (this.unreadKeys.size === 0) {
      return;
    }
    this.unreadKeys.clear();
    this.afterReadChange();
  }

  private afterReadChange(): void {
    this.persist();
    this.updateIndicators();
    void this.panel.update(this.feedback, this.unreadKeys);
  }

  private persist(): void {
    const state = this.context.globalState;
    void state.update(this.stateKey("seen"), [...this.seenKeys]);
    void state.update(this.stateKey("unread"), [...this.unreadKeys]);
    void state.update(this.stateKey("cache"), this.feedback);
    void state.update(this.stateKey("legacyUnread"), undefined);
  }

/**
 * Updates the status bar item and the sidebar badge. With unread feedback the
 * item uses the warning background, the only highlight colors VS Code allows
 * for status bar items (warning and error).
 */
  private updateIndicators(): void {
    const count = this.unreadKeys.size;
    if (count > 0) {
      this.feedbackItem.text = `$(mail) ${count}`;
      this.feedbackItem.tooltip = t("Classroom 50: {0} unread feedback — click to open", count);
      this.feedbackItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else {
      this.feedbackItem.text = "$(mail)";
      this.feedbackItem.tooltip = t("Classroom 50: open feedback");
      this.feedbackItem.backgroundColor = undefined;
    }
    setFeedbackBadge(count);
  }

  private stateKey(kind: "seen" | "unread" | "cache" | "legacyUnread"): string {
    const prefixes = {
      seen: "seenCommentKeys",
      unread: "unreadFeedbackKeys",
      cache: "feedbackCache",
      legacyUnread: "unreadComments",
    };
    return `${prefixes[kind]}_${this.repoInfo.repo}`;
  }
}

/**
 * Enables the student features of an assignment repository: feedback
 * monitoring, feedback and support panels, status bar buttons and Submit.
 */
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
    workspacePath,
  );
  const supportPanel = new SupportPanel(
    t("Support materials — {0}", config["assignment-name"]),
    config["support-links"],
  );
  context.subscriptions.push({ dispose: () => supportPanel.dispose() });
  let isSubmitting = false;

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.checkFeedback, async () => {
      const newCount = await monitor.check();
      if (newCount > 0) {
        return;
      }
      if (monitor.unreadCount > 0) {
        await monitor.openPanel();
      } else {
        vscode.window.showInformationMessage(t("Classroom 50: no new feedback."));
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openFeedback, () =>
      monitor.openPanel(),
    ),
    vscode.commands.registerCommand(COMMANDS.openSupportLinks, () => {
      if (Object.keys(config["support-links"]).length === 0) {
        vscode.window.showInformationMessage(
          t("Classroom 50: no support materials configured."),
        );
        return;
      }
      supportPanel.show();
    }),
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
          config.autograder,
        );
      } finally {
        isSubmitting = false;
      }
    }),
  );

  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.checkFeedback,
    `$(bell) ${t("Check Feedback")}`,
    t("Classroom 50: check for new feedback"),
    COMMANDS.checkFeedback,
  );
  registerFeedbackPRButton(context, feedbackPRUrl(repoInfo, prNumber));
  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.submitAssignment,
    `$(cloud-upload) ${t("Submit")}`,
    config.autograder
      ? t("Classroom 50: submit your work and run the autograder")
      : t("Classroom 50: submit your work"),
    COMMANDS.submitAssignment,
  );
  if (Object.keys(config["support-links"]).length > 0) {
    createStatusBarButton(
      context,
      STATUS_BAR_PRIORITY.supportLinks,
      `$(book) ${t("Support Materials")}`,
      t("Classroom 50: open support materials"),
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

/**
 * Adds the button that opens the Feedback PR in the browser. Also used for
 * teachers who open a student's repository.
 */
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
    `$(git-pull-request) ${t("Feedback PR")}`,
    t("Classroom 50: open feedback PR in browser"),
    COMMANDS.openFeedbackPR,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "classroom50.hasFeedbackPR",
    true,
  );
}

/**
 * Submits the assignment and handles what comes after it:
 * - synchronizes the local repository with the submitted version;
 * - if the assignment has an autograder (`autograder: true` in the
 *   configuration), schedules a feedback check a few minutes later, when the
 *   autograder has usually finished. Without one, it only confirms the submit.
 */
async function submitAndScheduleCheck(
  context: vscode.ExtensionContext,
  monitor: FeedbackMonitor,
  workspacePath: string,
  repositoryUrl: string,
  hasAutograder: boolean,
): Promise<void> {
  const submitted = await runSubmit(workspacePath);
  if (!submitted) {
    return;
  }

  await reportSyncResult(await syncAfterSubmit(workspacePath));

  if (!hasAutograder) {
    vscode.window.showInformationMessage(t("Classroom 50: submission sent!"));
    return;
  }

  const timeout = setTimeout(
    () => void monitor.check(),
    AUTOGRADER_CHECK_DELAY_MS,
  );
  context.subscriptions.push({ dispose: () => clearTimeout(timeout) });

  const action = await vscode.window.showInformationMessage(
    t("Classroom 50: submission sent! The autograder is running — new feedback will be checked in a few minutes."),
    t(ACTIONS.viewAutograder),
  );
  if (action === t(ACTIONS.viewAutograder)) {
    openInBrowser(`${repositoryUrl}/actions`);
  }
}

/**
 * Explains the cases where the local repository could not simply match the
 * submitted version (see gitsync.ts). Successful syncs need no message.
 */
async function reportSyncResult(result: SyncResult): Promise<void> {
  switch (result.status) {
    case "dirty":
      vscode.window.showWarningMessage(
        t("Classroom 50: {0} file(s) in your folder differ from the version you just submitted. Submit again if you want to include these changes.", result.changedFiles),
      );
      break;
    case "localCommits":
      vscode.window.showWarningMessage(
        t("Classroom 50: your local repository has {0} commit(s) that are not in the submitted history, so it was not synchronized. Use \"git pull\" to integrate the submission.", result.commits),
      );
      break;
    case "synced":
    case "noUpstream":
    case "failed":
      break;
  }
}
