/**
 * Shared structure of the extension's Webview panels.
 */

import * as crypto from "crypto";

/** Escapes text before inserting it into HTML, so it is shown and never interpreted. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Styles shared by all panels. They use VS Code theme variables, so panels
// follow the user's theme (dark, light or high contrast).
const BASE_STYLES = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); padding: 12px 20px; line-height: 1.5; }
  h1 { font-size: 1.3em; margin: 0 0 4px; }
  .summary { display: flex; align-items: center; justify-content: space-between;
             margin-bottom: 16px; color: var(--vscode-descriptionForeground); }
  .card { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
          border-radius: 6px; padding: 12px 16px; margin-bottom: 14px;
          background: var(--vscode-editorWidget-background); }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  code { font-family: var(--vscode-editor-font-family); }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  footer { display: flex; gap: 8px; margin-top: 10px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; border-radius: 3px; padding: 5px 12px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .empty { color: var(--vscode-descriptionForeground); }
`;

// The only script of the panels: forwards clicks on elements with a
// `data-action` attribute to the extension through postMessage.
const CLICK_SCRIPT = `
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) {
        return;
      }
      event.preventDefault();
      const index = target.dataset.index;
      vscode.postMessage({
        action: target.dataset.action,
        key: target.dataset.key,
        index: index === undefined ? undefined : Number(index),
      });
    });
`;

/**
 * Builds a complete panel page with the shared styles and click script.
 *
 * The Content Security Policy blocks everything by default and allows only:
 * - styles and the script that carry this page's random nonce;
 * - images from https (e.g. GitHub avatars).
 * Any script or inline event handler inside comment text is therefore ignored.
 */
export function buildWebviewPage(styles: string, body: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${BASE_STYLES}${styles}</style>
</head>
<body>
${body}
  <script nonce="${nonce}">${CLICK_SCRIPT}</script>
</body>
</html>`;
}
