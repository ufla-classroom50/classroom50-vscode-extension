/**
 * Small reusable UI helpers.
 */

import * as vscode from "vscode";
import { t } from "./i18n";

/** Creates a visible status bar button that runs a command and is disposed with the extension. */
export function createStatusBarButton(
  context: vscode.ExtensionContext,
  priority: number,
  text: string,
  tooltip: string,
  command: string,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    priority,
  );
  item.text = text;
  item.tooltip = tooltip;
  item.command = command;
  item.show();
  context.subscriptions.push(item);
  return item;
}

/**
 * Opens a URL in the default browser, accepting only http and https. Links
 * come from configuration files and GitHub, so other schemes (file:,
 * command:, vscode:...) are blocked.
 */
export function openInBrowser(url: string): void {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(url, true);
  } catch {
    vscode.window.showWarningMessage(
      t("Classroom 50: could not open link because the URL is invalid."),
    );
    return;
  }

  const scheme = uri.scheme.toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    vscode.window.showWarningMessage(
      t("Classroom 50: only http(s) links are allowed."),
    );
    return;
  }

  void vscode.env.openExternal(uri);
}
