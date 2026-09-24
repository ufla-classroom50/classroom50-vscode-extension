import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  ACTIONS,
  ANNOUNCEMENT_PLACEHOLDER,
  COMMANDS,
  STATUS_BAR_PRIORITY,
} from "./constants";
import { fetchFeedbackPR, fetchStudentRepos, postComment } from "./github";
import { createStatusBarButton } from "./ui";
import { StudentRepo } from "./types";

interface StudentPickItem extends vscode.QuickPickItem {
  repo: string;
}

export function registerTeacherFeatures(
  context: vscode.ExtensionContext,
  token: string,
  org: string,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.listStudents, () =>
      listStudents(token, org),
    ),
    vscode.commands.registerCommand(COMMANDS.sendAnnouncement, () =>
      sendAnnouncement(token, org),
    ),
  );

  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.listStudents,
    "$(organization) List Students",
    "Classroom 50: list students and open their repositories",
    COMMANDS.listStudents,
  );
  createStatusBarButton(
    context,
    STATUS_BAR_PRIORITY.sendAnnouncement,
    "$(megaphone) Send Announcement",
    "Classroom 50: send announcement to selected students",
    COMMANDS.sendAnnouncement,
  );
}

async function promptStudentRepos(
  token: string,
  org: string,
): Promise<StudentRepo[] | undefined> {
  const classroomAssignment = await vscode.window.showInputBox({
    prompt:
      "Enter the classroom-assignment prefix (e.g. ppoo-2026-atividade-1)",
    placeHolder: "classroom-assignment",
  });
  if (!classroomAssignment) {
    return undefined;
  }

  const studentRepos = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Classroom 50: fetching students...",
    },
    () => fetchStudentRepos(token, org, classroomAssignment),
  );

  if (studentRepos.length === 0) {
    vscode.window.showInformationMessage(
      "Classroom 50: no student repositories found.",
    );
    return undefined;
  }

  return studentRepos;
}

function toPickItems(studentRepos: StudentRepo[]): StudentPickItem[] {
  return studentRepos.map((s) => ({
    label: s.username,
    description:
      s.lastCommitDate.getTime() > 0
        ? s.lastCommitDate.toLocaleString()
        : "no commits",
    repo: s.name,
  }));
}

async function listStudents(token: string, org: string): Promise<void> {
  const studentRepos = await promptStudentRepos(token, org);
  if (!studentRepos) {
    return;
  }

  const selected = await vscode.window.showQuickPick(
    toPickItems(studentRepos),
    {
      placeHolder: "Select a student to open their repository",
    },
  );
  if (selected) {
    await openStudentRepo(org, selected.repo);
  }
}

async function openStudentRepo(org: string, repo: string): Promise<void> {
  const localBasePath = path.join(os.homedir(), "classroom50-students", org);
  const localRepoPath = path.join(localBasePath, repo);

  if (!fs.existsSync(localRepoPath)) {
    fs.mkdirSync(localBasePath, { recursive: true });

    const cloned = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Classroom 50: cloning ${repo}...`,
      },
      async () => {
        try {
          execFileSync(
            "git",
            ["clone", `https://github.com/${org}/${repo}.git`, localRepoPath],
            { cwd: localBasePath },
          );
          return true;
        } catch (err) {
          console.error("Classroom 50: git clone failed", err);
          return false;
        }
      },
    );

    if (!cloned) {
      vscode.window.showErrorMessage(`Classroom 50: failed to clone ${repo}.`);
      return;
    }
  }

  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(localRepoPath),
    true,
  );
}

async function sendAnnouncement(token: string, org: string): Promise<void> {
  const studentRepos = await promptStudentRepos(token, org);
  if (!studentRepos) {
    return;
  }

  const selected = await vscode.window.showQuickPick(
    toPickItems(studentRepos),
    {
      placeHolder: "Select the students who should receive the announcement",
      canPickMany: true,
    },
  );
  if (!selected || selected.length === 0) {
    return;
  }

  const text = await getAnnouncementText();
  if (!text) {
    vscode.window.showInformationMessage(
      "Classroom 50: announcement cancelled.",
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `You are about to send this announcement to ${selected.length} student(s). Continue?`,
    { modal: true },
    ACTIONS.send,
  );
  if (confirm !== ACTIONS.send) {
    return;
  }

  const failedStudents: string[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Classroom 50: sending announcement",
    },
    async (progress) => {
      for (const [index, student] of selected.entries()) {
        progress.report({
          message: `${index + 1}/${selected.length} — ${student.label}`,
          increment: 100 / selected.length,
        });

        const prNumber = await fetchFeedbackPR(token, org, student.repo);
        const sent =
          prNumber !== undefined &&
          (await postComment(token, org, student.repo, prNumber, text));
        if (!sent) {
          failedStudents.push(student.label);
        }
      }
    },
  );

  if (failedStudents.length === 0) {
    vscode.window.showInformationMessage(
      `Classroom 50: announcement sent to all ${selected.length} student(s).`,
    );
  } else {
    vscode.window.showWarningMessage(
      `Classroom 50: announcement sent, but failed for: ${failedStudents.join(", ")}.`,
    );
  }
}

async function getAnnouncementText(): Promise<string | undefined> {
  const tempFilePath = path.join(
    os.tmpdir(),
    `c50-announcement-${Date.now()}.md`,
  );
  fs.writeFileSync(tempFilePath, `${ANNOUNCEMENT_PLACEHOLDER}\n`, "utf8");

  const doc = await vscode.workspace.openTextDocument(tempFilePath);
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.window.showInformationMessage(
    "Write your announcement in the editor. Save the file (Ctrl+S) when you are done.",
  );

  await new Promise<void>((resolve) => {
    const disposable = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
      if (savedDoc.uri.toString() === doc.uri.toString()) {
        disposable.dispose();
        resolve();
      }
    });
  });

  const text = fs
    .readFileSync(tempFilePath, "utf8")
    .replace(ANNOUNCEMENT_PLACEHOLDER, "")
    .trim();

  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  fs.rmSync(tempFilePath, { force: true });

  return text.length > 0 ? text : undefined;
}
