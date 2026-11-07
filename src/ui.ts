import * as vscode from "vscode";
import { t } from "./i18n";

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
