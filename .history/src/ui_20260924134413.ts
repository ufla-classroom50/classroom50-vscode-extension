import * as vscode from "vscode";

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
  vscode.env.openExternal(vscode.Uri.parse(url));
}