import * as vscode from "vscode";
import { t } from "./i18n";
import { openInBrowser } from "./ui";
import { buildWebviewPage, escapeHtml } from "./webview";

interface PanelMessage {
  action: "openLink";
  index?: number;
}

const PANEL_VIEW_TYPE = "classroom50.supportMaterials";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export class SupportPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly entries: Array<[string, string]>;

  constructor(
    private readonly title: string,
    links: Record<string, string>,
  ) {
    this.entries = Object.entries(links);
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      this.title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [],
      },
    );
    this.panel.iconPath = new vscode.ThemeIcon("book");
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.onDidReceiveMessage((message: PanelMessage) => {
      if (message.action !== "openLink" || typeof message.index !== "number") {
        return;
      }
      const entry = this.entries[message.index];
      if (entry) {
        openInBrowser(entry[1]);
      }
    });
    this.panel.webview.html = this.buildHtml();
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private buildHtml(): string {
    const cards = this.entries
      .map(
        ([name, url], index) => `
      <article class="card link" data-action="openLink" data-index="${index}"
               title="${escapeHtml(url)}">
        <div class="icon">📖</div>
        <div class="text">
          <strong>${escapeHtml(name)}</strong>
          <span class="host">${escapeHtml(hostOf(url))}</span>
        </div>
        <button class="secondary" data-action="openLink" data-index="${index}">${escapeHtml(t("Open"))} ↗</button>
      </article>`,
      )
      .join("");

    const styles = `
  .card.link { display: flex; align-items: center; gap: 12px; cursor: pointer; }
  .card.link:hover { border-color: var(--vscode-focusBorder); }
  .icon { font-size: 1.4em; }
  .text { display: flex; flex-direction: column; flex: 1; }
  .host { font-size: .85em; color: var(--vscode-descriptionForeground); }
`;

    return buildWebviewPage(
      styles,
      `  <h1>${escapeHtml(this.title)}</h1>
  <div class="summary"><span>${escapeHtml(t("{0} material(s) — opens in your browser", this.entries.length))}</span></div>
  ${cards}`,
    );
  }
}
