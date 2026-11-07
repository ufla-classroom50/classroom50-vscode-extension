import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { COMMANDS, STUDENT_CLONE_DIR, STUDENT_VIEW_ID } from "./constants";
import {
  fetchStudentClassrooms,
  fetchUserLogin,
  repoExists,
  studentRepoPrefix,
} from "./github";
import { ensureStudentCli } from "./submit";
import { StudentClassroom } from "./types";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);
const ACCEPT_TIMEOUT_MS = 3 * 60 * 1000;

type AssignmentState = "notAccepted" | "accepted" | "cloned";

interface StudentAssignment {
  org: string;
  classroom: string;
  slug: string;
  name: string;
  repo: string;
  state: AssignmentState;
}

type StudentNode =
  | { kind: "organization"; org: string }
  | { kind: "classroom"; classroom: StudentClassroom }
  | { kind: "assignment"; assignment: StudentAssignment };

function localRepoPath(org: string, repo: string): string {
  return path.join(os.homedir(), STUDENT_CLONE_DIR, org, repo);
}

function isSamePath(a: string | undefined, b: string): boolean {
  if (!a) {
    return false;
  }
  const normalize = (p: string) => {
    const resolved = path.resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

class StudentTreeProvider implements vscode.TreeDataProvider<StudentNode> {
  classrooms: StudentClassroom[] = [];
  assignments = new Map<string, StudentAssignment[]>();

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  refresh(): void {
    this.changeEmitter.fire();
  }

  getChildren(element?: StudentNode): StudentNode[] {
    if (!element) {
      const orgs = [...new Set(this.classrooms.map((c) => c.org))];
      return orgs.map((org) => ({ kind: "organization", org }));
    }
    if (element.kind === "organization") {
      return this.classrooms
        .filter((c) => c.org === element.org)
        .map((classroom) => ({ kind: "classroom", classroom }));
    }
    if (element.kind === "classroom") {
      const key = classroomKey(element.classroom);
      return (this.assignments.get(key) ?? []).map((assignment) => ({
        kind: "assignment",
        assignment,
      }));
    }
    return [];
  }

  getTreeItem(node: StudentNode): vscode.TreeItem {
    if (node.kind === "organization") {
      const item = new vscode.TreeItem(
        node.org,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("organization");
      return item;
    }

    if (node.kind === "classroom") {
      const item = new vscode.TreeItem(
        node.classroom.classroomName,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("mortar-board");
      return item;
    }

    const { assignment } = node;
    const item = new vscode.TreeItem(assignment.name);
    item.contextValue = `assignment.${assignment.state}`;
    item.tooltip = assignment.repo;

    if (assignment.state === "notAccepted") {
      item.description = t("not accepted");
      item.iconPath = new vscode.ThemeIcon("circle-large-outline");
      item.command = {
        command: COMMANDS.acceptAssignment,
        title: t("Accept assignment"),
        arguments: [assignment],
      };
    } else if (assignment.state === "accepted") {
      item.description = t("not cloned");
      item.iconPath = new vscode.ThemeIcon("cloud");
      item.command = {
        command: COMMANDS.cloneAssignment,
        title: t("Clone assignment"),
        arguments: [assignment],
      };
    } else {
      const isOpen = isSamePath(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        localRepoPath(assignment.org, assignment.repo),
      );
      item.description = isOpen ? t("open") : undefined;
      item.iconPath = new vscode.ThemeIcon(isOpen ? "folder-opened" : "folder");
      item.command = {
        command: COMMANDS.openAssignment,
        title: t("Open assignment"),
        arguments: [assignment],
      };
    }
    return item;
  }
}

function toAssignment(
  arg: StudentAssignment | StudentNode | undefined,
): StudentAssignment | undefined {
  if (arg && "kind" in arg) {
    return arg.kind === "assignment" ? arg.assignment : undefined;
  }
  return arg;
}

function classroomKey(classroom: StudentClassroom): string {
  return `${classroom.org}/${classroom.classroom}`;
}

async function loadAssignments(
  token: string,
  login: string,
  classroom: StudentClassroom,
): Promise<StudentAssignment[]> {
  return Promise.all(
    classroom.assignments.map(async (a) => {
      const repo = `${studentRepoPrefix(classroom.classroom, a.slug)}${login.toLowerCase()}`;
      let state: AssignmentState = "notAccepted";
      if (fs.existsSync(localRepoPath(classroom.org, repo))) {
        state = "cloned";
      } else if (await repoExists(token, classroom.org, repo)) {
        state = "accepted";
      }
      return {
        org: classroom.org,
        classroom: classroom.classroom,
        slug: a.slug,
        name: a.name,
        repo,
        state,
      };
    }),
  );
}

async function cloneRepo(assignment: StudentAssignment): Promise<boolean> {
  const target = localRepoPath(assignment.org, assignment.repo);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("Classroom 50: cloning {0}...", assignment.name),
    },
    async () => {
      try {
        await execFileAsync("git", [
          "clone",
          `https://github.com/${assignment.org}/${assignment.repo}.git`,
          target,
        ]);
        return true;
      } catch (err) {
        console.error("Classroom 50: git clone failed", err);
        vscode.window.showErrorMessage(
          t("Classroom 50: failed to clone {0}.", assignment.repo),
        );
        return false;
      }
    },
  );
}

async function acceptRepo(assignment: StudentAssignment): Promise<boolean> {
  if (!(await ensureStudentCli(t("accepting an assignment")))) {
    return false;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("Classroom 50: accepting {0}...", assignment.name),
    },
    async () => {
      try {
        await execFileAsync(
          "gh",
          [
            "student",
            "accept",
            assignment.org,
            assignment.classroom,
            assignment.slug,
          ],
          { timeout: ACCEPT_TIMEOUT_MS },
        );
        return true;
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr?.trim();
        console.error("Classroom 50: gh student accept failed", err);
        const needsLogin = !stderr || /auth|login|token/i.test(stderr);
        vscode.window.showErrorMessage(
          t("Classroom 50: could not accept {0}.", assignment.name) +
            (stderr ? ` ${stderr.split("\n").pop()}` : "") +
            (needsLogin
              ? " " +
                t(
                  'If you have never used the GitHub CLI, run "gh auth login" in a terminal first.',
                )
              : ""),
        );
        return false;
      }
    },
  );
}

async function openRepo(assignment: StudentAssignment): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(localRepoPath(assignment.org, assignment.repo)),
    false,
  );
}

let studentTreeView: vscode.TreeView<StudentNode> | undefined;

export function setFeedbackBadge(count: number): void {
  if (!studentTreeView) {
    return;
  }
  studentTreeView.badge =
    count > 0
      ? { value: count, tooltip: t("{0} unread feedback", count) }
      : undefined;
}

export function registerStudentView(
  context: vscode.ExtensionContext,
  getToken: (interactive: boolean) => Promise<string | undefined>,
): () => Promise<void> {
  const provider = new StudentTreeProvider();
  const treeView = vscode.window.createTreeView(STUDENT_VIEW_ID, {
    treeDataProvider: provider,
  });
  studentTreeView = treeView;
  let token: string | undefined;
  let login: string | undefined;

  const load = async (interactive: boolean) => {
    token = await getToken(interactive);
    await vscode.commands.executeCommand(
      "setContext",
      "classroom50.signedIn",
      token !== undefined,
    );
    if (!token) {
      return;
    }

    await vscode.window.withProgress(
      { location: { viewId: STUDENT_VIEW_ID } },
      async () => {
        login = await fetchUserLogin(token!);
        provider.classrooms = login ? await fetchStudentClassrooms(token!) : [];
        const loaded = await Promise.all(
          provider.classrooms.map(
            async (c) =>
              [classroomKey(c), await loadAssignments(token!, login!, c)] as const,
          ),
        );
        provider.assignments = new Map(loaded);
      },
    );

    await vscode.commands.executeCommand(
      "setContext",
      "classroom50.isStudent",
      provider.classrooms.length > 0,
    );
    treeView.message =
      provider.classrooms.length === 0
        ? t(
            "No classrooms found. If you were invited to a class, accept the organization invitation on GitHub and refresh.",
          )
        : undefined;
    provider.refresh();
  };

  const updateState = (assignment: StudentAssignment, state: AssignmentState) => {
    assignment.state = state;
    provider.refresh();
  };

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand(COMMANDS.signIn, () => load(true)),
    vscode.commands.registerCommand(COMMANDS.refreshAssignments, () =>
      load(false),
    ),
    vscode.commands.registerCommand(
      COMMANDS.acceptAssignment,
      async (arg: StudentAssignment | StudentNode) => {
        const assignment = toAssignment(arg);
        if (!assignment || !(await acceptRepo(assignment))) {
          return;
        }
        updateState(assignment, "accepted");
        if (await cloneRepo(assignment)) {
          updateState(assignment, "cloned");
          await openRepo(assignment);
        }
      },
    ),
    vscode.commands.registerCommand(
      COMMANDS.cloneAssignment,
      async (arg: StudentAssignment | StudentNode) => {
        const assignment = toAssignment(arg);
        if (assignment && (await cloneRepo(assignment))) {
          updateState(assignment, "cloned");
          await openRepo(assignment);
        }
      },
    ),
    vscode.commands.registerCommand(
      COMMANDS.openAssignment,
      async (arg: StudentAssignment | StudentNode) => {
        const assignment = toAssignment(arg);
        if (assignment) {
          await openRepo(assignment);
        }
      },
    ),
  );

  return () => load(false);
}
