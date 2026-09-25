import * as vscode from "vscode";
import { loadConfig, parseGitRemote } from "./config";
import { feedbackPRUrl } from "./format";
import { fetchFeedbackPR, fetchTeacherOrgs, isOrgAdmin } from "./github";
import { registerFeedbackPRButton, registerStudentFeatures } from "./student";
import { registerTeacherFeatures } from "./teacher";
import { ExtensionConfig } from "./types";

const GITHUB_SCOPES = ["repo", "read:org"];

async function getGitHubToken(
  interactive: boolean,
): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      "github",
      GITHUB_SCOPES,
      interactive ? { createIfNone: true } : { silent: true },
    );
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

async function setupRepositoryFeatures(
  context: vscode.ExtensionContext,
  token: string,
  config: ExtensionConfig,
  workspacePath: string,
): Promise<void> {
  const repoInfo = parseGitRemote(workspacePath);
  if (!repoInfo) {
    return;
  }

  const [isTeacherOfRepo, prNumber] = await Promise.all([
    Promise.resolve(true),
    fetchFeedbackPR(token, repoInfo.org, repoInfo.repo),
  ]);

  if (isTeacherOfRepo) {
    if (prNumber) {
      registerFeedbackPRButton(context, feedbackPRUrl(repoInfo, prNumber));
    }
    return;
  }

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
): Promise<boolean> {
  const teacherOrgs = await fetchTeacherOrgs(token);
  if (teacherOrgs.length === 0) {
    return false;
  }

  await vscode.commands.executeCommand(
    "setContext",
    "classroom50.isTeacher",
    true,
  );
  registerTeacherFeatures(context, token, teacherOrgs);
  return true;
}

export async function activate(context: vscode.ExtensionContext) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const config = workspacePath ? loadConfig(workspacePath) : undefined;

  let token: string | undefined;
  if (config && workspacePath) {
    token = await getGitHubToken(true);
    if (!token) {
      vscode.window.showErrorMessage(
        "Classroom 50: could not authenticate with GitHub.",
      );
      return;
    }
  } else {
    token = await getGitHubToken(false);
  }

  let teacherReady = false;

  const tryTeacherSetup = async (currentToken: string) => {
    if (!teacherReady) {
      teacherReady = await setupTeacherFeatures(context, currentToken);
    }
  };

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(async (event) => {
      if (event.provider.id !== "github" || teacherReady) {
        return;
      }
      const newToken = await getGitHubToken(false);
      if (newToken) {
        await tryTeacherSetup(newToken);
      }
    }),
  );

  const tasks: Promise<unknown>[] = [];
  if (token) {
    tasks.push(tryTeacherSetup(token));
  }
  if (token && config && workspacePath) {
    tasks.push(setupRepositoryFeatures(context, token, config, workspacePath));
  }
  await Promise.all(tasks);
}

export function deactivate() {}
