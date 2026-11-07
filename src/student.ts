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
import { runSubmit } from "./submit";
import { createStatusBarButton, openInBrowser } from "./ui";
import { ExtensionConfig, Feedback, RepoInfo } from "./types";

const MAX_INDIVIDUAL_TOASTS = 3;

class FeedbackMonitor {
  private readonly seenKeys: Set<string>;
  private readonly unreadKeys: Set<string>;
  private feedback: Feedback[];
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

    this.panel = new FeedbackPanel(`Feedback — ${config["assignment-name"]}`, {
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
        `💬 ${newFeedback.length} new feedback items — ${this.config["assignment-name"]}`,
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

  private async promptAction(
    item: Feedback | undefined,
    message: string,
  ): Promise<void> {
    const actions: string[] = [ACTIONS.openFeedback];
    if (item) {
      actions.push(ACTIONS.viewOnGitHub);
    }
    const action = await vscode.window.showInformationMessage(
      message,
      ...actions,
    );

    if (action === ACTIONS.openFeedback) {
      await this.openPanel();
    } else if (action === ACTIONS.viewOnGitHub && item) {
      this.openOnGitHub(item.key);
    }
  }

  private find(key: string): Feedback | undefined {
    return this.feedback.find((f) => f.key === key);
  }

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

  private async openInlineFile(key: string, index: number): Promise<void> {
    const comment = this.find(key)?.inline[index];
    if (!comment) {
      return;
    }
    const root = path.resolve(this.workspacePath);
    const filePath = path.resolve(root, comment.path);
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
      vscode.window.showWarningMessage(
        `Classroom 50: ${comment.path} was not found in this folder.`,
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

  private updateIndicators(): void {
    const count = this.unreadKeys.size;
    if (count > 0) {
      this.feedbackItem.text = `$(mail) ${count}`;
      this.feedbackItem.tooltip = `Classroom 50: ${count} unread feedback — click to open`;
      this.feedbackItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else {
      this.feedbackItem.text = "$(mail)";
      this.feedbackItem.tooltip = "Classroom 50: open feedback";
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
        vscode.window.showInformationMessage("Classroom 50: no new feedback.");
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openFeedback, () =>
      monitor.openPanel(),
    ),
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
    "$(bell) Check Feedback",
    "Classroom 50: check for new feedback",
    COMMANDS.checkFeedback,
  );
  registerFeedbackPRButton(context, feedbackPRUrl(repoInfo, prNumber));
  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.submitAssignment,
    "$(cloud-upload) Submit",
    config.autograder
      ? "Classroom 50: submit your work and run the autograder"
      : "Classroom 50: submit your work",
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
  hasAutograder: boolean,
): Promise<void> {
  const submitted = await runSubmit(workspacePath);
  if (!submitted) {
    return;
  }

  await reportSyncResult(await syncAfterSubmit(workspacePath));

  if (!hasAutograder) {
    vscode.window.showInformationMessage("Classroom 50: submission sent!");
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

async function reportSyncResult(result: SyncResult): Promise<void> {
  switch (result.status) {
    case "dirty":
      vscode.window.showWarningMessage(
        `Classroom 50: ${result.changedFiles} file(s) in your folder differ from the version you just submitted. Submit again if you want to include these changes.`,
      );
      break;
    case "localCommits":
      vscode.window.showWarningMessage(
        `Classroom 50: your local repository has ${result.commits} commit(s) that are not in the submitted history, so it was not synchronized. Use "git pull" to integrate the submission.`,
      );
      break;
    case "synced":
    case "noUpstream":
    case "failed":
      break;
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
