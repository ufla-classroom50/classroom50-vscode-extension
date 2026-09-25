import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  ACTIONS,
  ANNOUNCEMENT_PLACEHOLDER,
  COMMANDS,
  TEACHER_VIEW_ID,
} from "./constants";
import {
  fetchFeedbackPR,
  fetchOrgAssignments,
  fetchStudentRepos,
  postComment,
} from "./github";
import { AssignmentRef, StudentRepo } from "./types";

type TeacherNode =
  | { kind: "organization" }
  | { kind: "assignment" }
  | { kind: "student"; student: StudentRepo };

class TeacherTreeProvider implements vscode.TreeDataProvider<TeacherNode> {
  org: string | undefined;
  assignment: AssignmentRef | undefined;
  students: StudentRepo[] = [];
  readonly checked = new Set<string>();

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  refresh(): void {
    this.changeEmitter.fire();
  }

  getChildren(element?: TeacherNode): TeacherNode[] {
    if (element) {
      return [];
    }
    return [
      { kind: "organization" },
      { kind: "assignment" },
      ...this.students.map((student) => ({
        kind: "student" as const,
        student,
      })),
    ];
  }

  getTreeItem(node: TeacherNode): vscode.TreeItem {
    if (node.kind === "organization") {
      const item = new vscode.TreeItem("Organization");
      item.description = this.org ?? "click to select";
      item.iconPath = new vscode.ThemeIcon("organization");
      item.command = {
        command: COMMANDS.selectOrganization,
        title: "Select organization",
      };
      return item;
    }

    if (node.kind === "assignment") {
      const item = new vscode.TreeItem("Assignment");
      item.description = this.assignment
        ? `${this.assignment.name} (${this.assignment.classroomName})`
        : "click to select";
      item.iconPath = new vscode.ThemeIcon("book");
      item.command = {
        command: COMMANDS.selectAssignment,
        title: "Select assignment",
      };
      return item;
    }

    const { student } = node;
    const hasCommits = student.lastCommitDate.getTime() > 0;
    const item = new vscode.TreeItem(student.username);
    item.description = hasCommits
      ? student.lastCommitDate.toLocaleString()
      : "no commits";
    item.tooltip = `Open ${student.name}`;
    item.iconPath = new vscode.ThemeIcon("person");
    item.checkboxState = this.checked.has(student.name)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.command = {
      command: COMMANDS.openStudentRepo,
      title: "Open repository",
      arguments: [student.name],
    };
    return item;
  }
}

export function registerTeacherFeatures(
  context: vscode.ExtensionContext,
  token: string,
  adminOrgs: string[],
): void {
  const provider = new TeacherTreeProvider();
  const treeView = vscode.window.createTreeView(TEACHER_VIEW_ID, {
    treeDataProvider: provider,
  });

  if (adminOrgs.length === 1) {
    provider.org = adminOrgs[0];
  }

  const loadStudents = async () => {
    const { org, assignment } = provider;
    if (!org || !assignment) {
      vscode.window.showWarningMessage(
        "Classroom 50: select an organization and an assignment first.",
      );
      return;
    }

    provider.students = await vscode.window.withProgress(
      { location: { viewId: TEACHER_VIEW_ID } },
      () => fetchStudentRepos(token, org, assignment),
    );
    provider.checked.clear();
    treeView.message =
      provider.students.length === 0
        ? "No student repositories found for this assignment."
        : undefined;
    provider.refresh();
  };

  context.subscriptions.push(
    treeView,
    treeView.onDidChangeCheckboxState((event) => {
      for (const [node, state] of event.items) {
        if (node.kind !== "student") {
          continue;
        }
        if (state === vscode.TreeItemCheckboxState.Checked) {
          provider.checked.add(node.student.name);
        } else {
          provider.checked.delete(node.student.name);
        }
      }
    }),
    vscode.commands.registerCommand(COMMANDS.selectOrganization, async () => {
      const selected = await vscode.window.showQuickPick(adminOrgs, {
        placeHolder: "Select the organization",
      });
      if (selected && selected !== provider.org) {
        provider.org = selected;
        provider.assignment = undefined;
        provider.students = [];
        provider.checked.clear();
        treeView.message = undefined;
        provider.refresh();
      }
    }),
    vscode.commands.registerCommand(COMMANDS.selectAssignment, async () => {
      const org = provider.org;
      if (!org) {
        vscode.window.showWarningMessage(
          "Classroom 50: select an organization first.",
        );
        return;
      }

      const assignments = await vscode.window.withProgress(
        { location: { viewId: TEACHER_VIEW_ID } },
        () => fetchOrgAssignments(token, org),
      );
      if (assignments.length === 0) {
        vscode.window.showWarningMessage(
          `Classroom 50: no assignments found in ${org}.`,
        );
        return;
      }

      const selected = await vscode.window.showQuickPick(
        assignments.map((a) => ({
          label: a.name,
          description: a.classroomName,
          detail: `${a.classroom}/${a.slug}`,
          assignment: a,
        })),
        { placeHolder: "Select the assignment", matchOnDescription: true },
      );
      if (selected) {
        provider.assignment = selected.assignment;
        await loadStudents();
      }
    }),
    vscode.commands.registerCommand(COMMANDS.loadStudents, loadStudents),
    vscode.commands.registerCommand(COMMANDS.toggleAllStudents, () => {
      const allChecked =
        provider.students.length > 0 &&
        provider.checked.size === provider.students.length;
      provider.checked.clear();
      if (!allChecked) {
        provider.students.forEach((s) => provider.checked.add(s.name));
      }
      provider.refresh();
    }),
    vscode.commands.registerCommand(
      COMMANDS.openStudentRepo,
      (repo: string) => {
        if (provider.org) {
          return openStudentRepo(provider.org, repo);
        }
      },
    ),
    vscode.commands.registerCommand(COMMANDS.sendAnnouncement, () => {
      const selected = provider.students.filter((s) =>
        provider.checked.has(s.name),
      );
      if (!provider.org || selected.length === 0) {
        vscode.window.showWarningMessage(
          "Classroom 50: check the students who should receive the announcement first.",
        );
        return;
      }
      return sendAnnouncement(token, provider.org, selected);
    }),
  );

  provider.refresh();
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

async function sendAnnouncement(
  token: string,
  org: string,
  students: StudentRepo[],
): Promise<void> {
  const text = await getAnnouncementText();
  if (!text) {
    vscode.window.showInformationMessage(
      "Classroom 50: announcement cancelled.",
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `You are about to send this announcement to ${students.length} student(s). Continue?`,
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
      for (const [index, student] of students.entries()) {
        progress.report({
          message: `${index + 1}/${students.length} — ${student.username}`,
          increment: 100 / students.length,
        });

        const prNumber = await fetchFeedbackPR(token, org, student.name);
        const sent =
          prNumber !== undefined &&
          (await postComment(token, org, student.name, prNumber, text));
        if (!sent) {
          failedStudents.push(student.username);
        }
      }
    },
  );

  if (failedStudents.length === 0) {
    vscode.window.showInformationMessage(
      `Classroom 50: announcement sent to all ${students.length} student(s).`,
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
