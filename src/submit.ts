/**
 * Assignment submission through the Classroom 50 CLI (`gh student`).
 */

import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { ACTIONS, STUDENT_CLI_INSTALL_URL } from "./constants";
import { openInBrowser } from "./ui";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);

// Name and source identify our task when VS Code reports that a task ended.
const TASK_NAME = "Submit assignment";
const TASK_SOURCE = "Classroom 50";

async function isStudentCliInstalled(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["student", "--help"]);
    return true;
  } catch {
    return false;
  }
}

function waitForTaskExit(): Promise<number | undefined> {
  return new Promise((resolve) => {
    const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
      const task = event.execution.task;
      if (task.name === TASK_NAME && task.source === TASK_SOURCE) {
        disposable.dispose();
        resolve(event.exitCode);
      }
    });
  });
}

/**
 * Checks that `gh` and the `gh-student` extension are installed and, if not,
 * offers the installation guide.
 *
 * @param purpose what the student was trying to do, shown in the message.
 */
export async function ensureStudentCli(purpose: string): Promise<boolean> {
  if (await isStudentCliInstalled()) {
    return true;
  }
  const action = await vscode.window.showErrorMessage(
    t("Classroom 50: {0} requires the GitHub CLI (gh) with the gh-student extension.", purpose),
    t(ACTIONS.installGuide),
  );
  if (action === t(ACTIONS.installGuide)) {
    openInBrowser(STUDENT_CLI_INSTALL_URL);
  }
  return false;
}

/**
 * Submits the assignment by running the official `gh student submit`, so the
 * extension follows Classroom 50's own submission process instead of
 * reimplementing it.
 *
 * It runs as a VS Code Task (not a hidden process) because the command may
 * need interaction: the first time, gh can ask the student to sign in in the
 * terminal. The task shows the output and reports its exit code back.
 *
 * @returns whether the submission succeeded (exit code 0).
 */
export async function runSubmit(workspacePath: string): Promise<boolean> {
  if (!(await ensureStudentCli(t("submitting")))) {
    return false;
  }

  const confirm = await vscode.window.showWarningMessage(
    t(
      "Submit your work? This commits and pushes your code to the main branch and starts the autograder.",
    ),
    { modal: true },
    t(ACTIONS.submit),
  );
  if (confirm !== t(ACTIONS.submit)) {
    return false;
  }

  const task = new vscode.Task(
    { type: "classroom50" },
    vscode.TaskScope.Workspace,
    TASK_NAME,
    TASK_SOURCE,
    new vscode.ShellExecution("gh", ["student", "submit"], {
      cwd: workspacePath,
    }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };

// Start listening before running the task, so a fast exit is not missed.
  const exitPromise = waitForTaskExit();
  await vscode.tasks.executeTask(task);
  const exitCode = await exitPromise;

  if (exitCode !== 0) {
    vscode.window.showErrorMessage(
      t("Classroom 50: submission failed. Check the terminal output for details."),
    );
    return false;
  }

  return true;
}
