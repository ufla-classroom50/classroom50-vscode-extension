import * as vscode from "vscode";
import { loadConfig, parseGitRemote } from "./config";
import {
  fetchFeedbackPR,
  getAuthenticatedUsername,
  getUserRole,
} from "./github";
import { registerStudentFeatures } from "./student";
import { registerTeacherFeatures } from "./teacher";
import { RepoInfo } from "./types";

async function getGitHubToken(): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      "github",
      ["repo", "read:org"],
      { createIfNone: true },
    );
    return session.accessToken;
  } catch {
    return undefined;
  }
}

async function setupStudentFeatures(
  context: vscode.ExtensionContext,
  token: string,
  workspacePath: string,
  repoInfo: RepoInfo,
): Promise<void> {
  const config = loadConfig(workspacePath);
  if (!config) {
    return;
  }

  const prNumber = await fetchFeedbackPR(token, repoInfo.org, repoInfo.repo);
  if (!prNumber) {
    vscode.window.showWarningMessage("Classroom 50: feedback PR not found.");
    return;
  }

  await registerStudentFeatures(
    context,
    token,
    config,
    repoInfo,
    prNumber,
    workspacePath,
  );
}

async function setupTeacherFeatures(
  context: vscode.ExtensionContext,
  token: string,
  org: string,
): Promise<void> {
  const username = await getAuthenticatedUsername(token);
  if (!username) {
    return;
  }

  const role = await getUserRole(token, org, username);
  if (role === "admin") {
    registerTeacherFeatures(context, token, org);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const token = await getGitHubToken();
  if (!token) {
    vscode.window.showErrorMessage(
      "Classroom 50: could not authenticate with GitHub.",
    );
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage(
      "Classroom 50: no folder open in workspace.",
    );
    return;
  }

  const repoInfo = parseGitRemote(workspacePath);
  if (!repoInfo) {
    return;
  }

  await Promise.all([
    setupStudentFeatures(context, token, workspacePath, repoInfo),
    setupTeacherFeatures(context, token, repoInfo.org),
  ]);
}

export function deactivate() {}
