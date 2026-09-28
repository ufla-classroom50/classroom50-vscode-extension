import * as vscode from "vscode";
import { hasConfigFile, loadConfig, parseGitRemote } from "./config";
import { ACTIONS } from "./constants";
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
    isOrgAdmin(token, repoInfo.org),
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

async function promptWorkspaceTrust(): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    "Classroom 50: this folder is a Classroom 50 assignment. Trust it to enable feedback notifications and submission.",
    ACTIONS.manageTrust,
  );
  if (action === ACTIONS.manageTrust) {
    await vscode.commands.executeCommand("workbench.trust.manage");
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let teacherReady = false;
  let repositoryReady = false;

  const tryTeacherSetup = async (token: string) => {
    if (!teacherReady) {
      teacherReady = await setupTeacherFeatures(context, token);
    }
  };

  const tryRepositorySetup = async () => {
    if (repositoryReady || !workspacePath || !vscode.workspace.isTrusted) {
      return;
    }

    const config = loadConfig(workspacePath);
    if (!config) {
      return;
    }

    const token = await getGitHubToken(true);
    if (!token) {
      vscode.window.showErrorMessage(
        "Classroom 50: could not authenticate with GitHub.",
      );
      return;
    }

    repositoryReady = true;
    await Promise.all([
      setupRepositoryFeatures(context, token, config, workspacePath),
      tryTeacherSetup(token),
    ]);
  };

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(async (event) => {
      if (event.provider.id !== "github" || teacherReady) {
        return;
      }
      const token = await getGitHubToken(false);
      if (token) {
        await tryTeacherSetup(token);
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void tryRepositorySetup()),
  );

  if (
    workspacePath &&
    !vscode.workspace.isTrusted &&
    hasConfigFile(workspacePath)
  ) {
    void promptWorkspaceTrust();
  }

  await tryRepositorySetup();

  if (!teacherReady) {
    const token = await getGitHubToken(false);
    if (token) {
      await tryTeacherSetup(token);
    }
  }
}

export function deactivate() {}
