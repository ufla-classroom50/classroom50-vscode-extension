import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { ACTIONS, STUDENT_CLI_INSTALL_URL } from "./constants";
import { openInBrowser } from "./ui";

const execFileAsync = promisify(execFile);

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

export async function runSubmit(workspacePath: string): Promise<boolean> {
  if (!(await isStudentCliInstalled())) {
    const action = await vscode.window.showErrorMessage(
      "Classroom 50: submitting requires the GitHub CLI (gh) with the gh-student extension.",
      ACTIONS.installGuide,
    );
    if (action === ACTIONS.installGuide) {
      openInBrowser(STUDENT_CLI_INSTALL_URL);
    }
    return false;
  }

  const confirm = await vscode.window.showWarningMessage(
    "Submit your work? This commits and pushes your code to the main branch and starts the autograder.",
    { modal: true },
    ACTIONS.submit,
  );
  if (confirm !== ACTIONS.submit) {
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

  const exitPromise = waitForTaskExit();
  await vscode.tasks.executeTask(task);
  const exitCode = await exitPromise;

  if (exitCode !== 0) {
    vscode.window.showErrorMessage(
      "Classroom 50: submission failed. Check the terminal output for details.",
    );
    return false;
  }

  return true;
}
