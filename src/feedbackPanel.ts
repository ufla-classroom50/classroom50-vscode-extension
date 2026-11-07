import * as vscode from "vscode";
import { formatInlineLocation } from "./format";
import { locale, t } from "./i18n";
import { Feedback } from "./types";
import { buildWebviewPage, escapeHtml } from "./webview";

export interface FeedbackPanelHandlers {
  markAsRead(key: string): void;
  markAllAsRead(): void;
  openOnGitHub(key: string, inlineIndex?: number): void;
  openInlineFile(key: string, inlineIndex: number): void;
}

interface PanelMessage {
  action: "markRead" | "markAllRead" | "openUrl" | "openFile";
  key?: string;
  index?: number;
}

const PANEL_VIEW_TYPE = "classroom50.feedback";

async function renderMarkdown(text: string): Promise<string> {
  try {
    const html = await vscode.commands.executeCommand<string>(
      "markdown.api.render",
      text,
    );
    if (typeof html === "string") {
      return html;
    }
  } catch (err) {
    console.error("Classroom 50: could not render markdown", err);
  }
  return `<pre>${escapeHtml(text)}</pre>`;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(locale());
}

export class FeedbackPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly renderCache = new Map<string, string>();

  constructor(
    private readonly title: string,
    private readonly handlers: FeedbackPanelHandlers,
  ) {}

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  async show(feedback: Feedback[], unreadKeys: Set<string>): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        PANEL_VIEW_TYPE,
        this.title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
          retainContextWhenHidden: true,
        },
      );
      this.panel.iconPath = new vscode.ThemeIcon("comment-discussion");
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((message: PanelMessage) =>
        this.handleMessage(message),
      );
    } else {
      this.panel.reveal(undefined, true);
    }
    await this.update(feedback, unreadKeys);
  }

  async update(feedback: Feedback[], unreadKeys: Set<string>): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = await this.buildHtml(feedback, unreadKeys);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private handleMessage(message: PanelMessage): void {
    const { action, key, index } = message;
    if (action === "markAllRead") {
      this.handlers.markAllAsRead();
      return;
    }
    if (typeof key !== "string") {
      return;
    }
    if (action === "markRead") {
      this.handlers.markAsRead(key);
    } else if (action === "openUrl") {
      this.handlers.openOnGitHub(
        key,
        typeof index === "number" ? index : undefined,
      );
    } else if (action === "openFile" && typeof index === "number") {
      this.handlers.openInlineFile(key, index);
    }
  }

  private async rendered(text: string): Promise<string> {
    const cached = this.renderCache.get(text);
    if (cached !== undefined) {
      return cached;
    }
    const html = await renderMarkdown(text);
    this.renderCache.set(text, html);
    return html;
  }

  private async buildCard(item: Feedback, isUnread: boolean): Promise<string> {
    const key = escapeHtml(item.key);
    const avatar = item.avatarUrl?.startsWith("https://")
      ? `<img class="avatar" src="${escapeHtml(item.avatarUrl)}" alt="">`
      : `<div class="avatar placeholder"></div>`;
    const body =
      item.body.trim().length > 0
        ? `<div class="body">${await this.rendered(item.body)}</div>`
        : "";

    let inline = "";
    if (item.inline.length > 0) {
      const entries = await Promise.all(
        item.inline.map(
          async (comment, index) => `
            <li>
              <div class="inline-head">
                <a href="#" data-action="openFile" data-key="${key}" data-index="${index}"
                   title="${escapeHtml(t("Open in the editor"))}">📍 ${escapeHtml(formatInlineLocation(comment))}</a>
                <a href="#" class="muted" data-action="openUrl" data-key="${key}" data-index="${index}">GitHub ↗</a>
              </div>
              <div class="inline-body">${await this.rendered(comment.body)}</div>
            </li>`,
        ),
      );
      inline = `
        <div class="inline">
          <div class="inline-title">${escapeHtml(t("Inline comments ({0})", item.inline.length))}</div>
          <ul>${entries.join("")}</ul>
        </div>`;
    }

    const markButton = isUnread
      ? `<button data-action="markRead" data-key="${key}">${escapeHtml(t("Mark as read"))}</button>`
      : "";

    return `
      <article class="card ${isUnread ? "unread" : "read"}">
        <header>
          ${avatar}
          <div class="who">
            <strong>@${escapeHtml(item.author)}</strong>
            <span class="date">${escapeHtml(formatDate(item.createdAt))}</span>
          </div>
          ${isUnread ? `<span class="tag">${escapeHtml(t("New"))}</span>` : ""}
        </header>
        ${body}
        ${inline}
        <footer>
          ${markButton}
          <button class="secondary" data-action="openUrl" data-key="${key}">${escapeHtml(t("View on GitHub"))}</button>
        </footer>
      </article>`;
  }

  private async buildHtml(
    feedback: Feedback[],
    unreadKeys: Set<string>,
  ): Promise<string> {
    const unread = feedback.filter((f) => unreadKeys.has(f.key));
    const read = feedback.filter((f) => !unreadKeys.has(f.key));

    const unreadCards = (
      await Promise.all(unread.map((f) => this.buildCard(f, true)))
    ).join("");
    const readCards = (
      await Promise.all(read.map((f) => this.buildCard(f, false)))
    ).join("");

    const unreadSection =
      unread.length > 0
        ? unreadCards
        : `<p class="empty">${escapeHtml(t("No unread feedback."))}</p>`;
    const readSection =
      read.length > 0
        ? `<details class="read-section"><summary>${escapeHtml(t("Read ({0})", read.length))}</summary>${readCards}</details>`
        : "";
    const markAll =
      unread.length > 1
        ? `<button class="secondary" data-action="markAllRead">${escapeHtml(t("Mark all as read"))}</button>`
        : "";

    const styles = `
  .card.unread { border-left: 4px solid var(--vscode-editorWarning-foreground, #cca700); }
  .card.read { opacity: .6; }
  .card.read:hover { opacity: .9; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; }
  .avatar.placeholder { background: var(--vscode-badge-background); }
  .who { display: flex; flex-direction: column; flex: 1; }
  .date { font-size: .85em; color: var(--vscode-descriptionForeground); }
  .tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
         border-radius: 10px; padding: 1px 8px; font-size: .8em; font-weight: 600; }
  .body img { max-width: 100%; }
  .body pre, .inline-body pre { background: var(--vscode-textCodeBlock-background);
         padding: 8px; overflow-x: auto; border-radius: 4px; }
  .inline { margin-top: 10px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
            padding-top: 8px; }
  .inline-title { font-weight: 600; margin-bottom: 4px; }
  .inline ul { list-style: none; padding: 0; margin: 0; }
  .inline li { margin: 6px 0 10px; }
  .inline-head { display: flex; gap: 12px; align-items: baseline; }
  .inline-body { margin-left: 22px; }
  .inline-body > :first-child { margin-top: 2px; }
  a.muted { color: var(--vscode-descriptionForeground); font-size: .85em; }
  details.read-section { margin-top: 20px; }
  details.read-section > summary { cursor: pointer; color: var(--vscode-descriptionForeground);
                                   margin-bottom: 12px; }
`;
    return buildWebviewPage(
      styles,
      `  <h1>${escapeHtml(this.title)}</h1>
  <div class="summary">
    <span>${escapeHtml(t("{0} unread · {1} total", unread.length, feedback.length))}</span>
    ${markAll}
  </div>
  ${unreadSection}
  ${readSection}`,
    );
  }
}
