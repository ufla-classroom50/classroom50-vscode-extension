/**
 * Extension entry point.
 *
 * Decides what to enable based on the open folder and on who the user is:
 * - the Assignments sidebar for students (accept, clone and open assignments);
 * - notifications, feedback panel and Submit inside an assignment repository;
 * - the Teacher sidebar for admins of a Classroom 50 organization.
 *
 * Architecture (each layer only uses the layers below it):
 * - entry: extension.ts
 * - features: student.ts, studentView.ts, teacher.ts, submit.ts, gitsync.ts,
 *   feedbackPanel.ts, supportPanel.ts
 * - services: github.ts (GitHub REST API), config.ts (configuration and git remote)
 * - support: i18n.ts, format.ts, ui.ts, webview.ts, constants.ts, types.ts
 */

import * as vscode from "vscode";
import { hasConfigFile, loadConfig, parseGitRemote } from "./config";
import { ACTIONS } from "./constants";
import { feedbackPRUrl } from "./format";
import { fetchFeedbackPR, fetchTeacherOrgs, isOrgAdmin } from "./github";
import { registerFeedbackPRButton, registerStudentFeatures } from "./student";
import { registerStudentView } from "./studentView";
import { registerTeacherFeatures } from "./teacher";
import { ExtensionConfig } from "./types";
import { initI18n, t } from "./i18n";

/**
 * GitHub scopes requested through the VS Code authentication API.
 * - `repo`: read private assignment repositories, their Feedback PR and comments,
 *   and post announcements as PR comments.
 * - `read:org`: read organization memberships and teams, used to tell teachers
 *   (organization admins) from students and to discover the student's classrooms.
 */
const GITHUB_SCOPES = ["repo", "read:org"];

/**
 * Returns a GitHub access token managed by VS Code, so the extension never
 * stores passwords or tokens itself.
 *
 * @param interactive `true` shows the sign-in prompt when there is no session;
 *   `false` only reuses an existing session and never interrupts the user.
 * @returns the token, or `undefined` when the user is not signed in or declined.
 */
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

/**
 * Enables the features of the assignment repository open in VS Code.
 *
 * The organization and repository come from the git remote, so the
 * configuration file does not need to repeat them. Organization admins are
 * teachers looking at a student's work: they only get the Feedback PR button,
 * without notifications, unread counter or Submit.
 */
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
    vscode.window.showWarningMessage(t("Classroom 50: feedback PR not found."));
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

/**
 * Enables the Teacher sidebar when the user administers at least one
 * organization that uses Classroom 50 (one that has the `classroom50`
 * configuration repository). Works in any folder, not only in assignments.
 *
 * @returns whether the teacher features were enabled.
 */
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

/**
 * In Restricted Mode the extension does not run git or gh in the folder. This
 * prompt explains why the assignment features are off and links to the
 * workspace trust settings; trusting the folder enables them without a reload.
 */
async function promptWorkspaceTrust(): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    t("Classroom 50: this folder is a Classroom 50 assignment. Trust it to enable feedback notifications and submission."),
    t(ACTIONS.manageTrust),
  );
  if (action === t(ACTIONS.manageTrust)) {
    await vscode.commands.executeCommand("workbench.trust.manage");
  }
}

/**
 * Entry point, called by VS Code after startup (`onStartupFinished`).
 *
 * Activation order:
 * 1. Load the language for messages and panels.
 * 2. Register the Assignments sidebar (student) with a silent sign-in.
 * 3. If the open folder has `.c50extension.json` and is trusted, sign in
 *    (interactively) and enable the student or teacher repository features.
 * 4. In any folder, enable the Teacher sidebar when the user is an admin of a
 *    Classroom 50 organization, again without forcing a sign-in prompt.
 */
export async function activate(context: vscode.ExtensionContext) {
  initI18n(context);
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let teacherReady = false;
  let repositoryReady = false;

  const tryTeacherSetup = async (token: string) => {
    if (!teacherReady) {
      teacherReady = await setupTeacherFeatures(context, token);
    }
  };

// Runs at most once. It is called again when the user trusts the folder.
// Only folders with the configuration file ask for sign-in, so the extension
// stays silent in any other project.
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
        t("Classroom 50: could not authenticate with GitHub."),
      );
      return;
    }

    repositoryReady = true;
    await Promise.all([
      setupRepositoryFeatures(context, token, config, workspacePath),
      tryTeacherSetup(token),
    ]);
  };

  const reloadStudentView = registerStudentView(context, getGitHubToken);

  context.subscriptions.push(
// Signing in anywhere (Accounts menu, Assignments sidebar, another
// extension) refreshes the student sidebar and may enable teacher mode.
    vscode.authentication.onDidChangeSessions(async (event) => {
      if (event.provider.id !== "github") {
        return;
      }
      void reloadStudentView();
      if (teacherReady) {
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

  void reloadStudentView();
  await tryRepositorySetup();

  if (!teacherReady) {
    const token = await getGitHubToken(false);
    if (token) {
      await tryTeacherSetup(token);
    }
  }
}

export function deactivate() {}
