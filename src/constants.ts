/**
 * Shared constants: file and repository names, command and view identifiers,
 * status bar order and button labels.
 */

export const CONFIG_FILE_NAME = ".c50extension.json";
// Fixed by Classroom 50 for the PR it opens in every student repository.
export const FEEDBACK_PR_TITLE = "Feedback";
// Configuration repository of a Classroom 50 organization; its presence marks
// the organization as a Classroom 50 one.
export const CONFIG_REPO_NAME = "classroom50";
export const TEACHER_VIEW_ID = "classroom50.teacherView";
export const STUDENT_VIEW_ID = "classroom50.studentView";
export const STUDENT_CLONE_DIR = "classroom50";
// Upper bound for paginated API requests (20 pages x 100 items).
export const MAX_PAGES = 20;
// After a submit, time until the automatic feedback check, when the autograder
// has usually finished.
export const AUTOGRADER_CHECK_DELAY_MS = 2 * 60 * 1000;
export const STUDENT_CLI_INSTALL_URL =
  "https://github.com/foundation50/classroom50/wiki/Installation";

export const COMMANDS = {
  checkFeedback: "classroom50-vscode-extension.checkFeedback",
  openFeedback: "classroom50-vscode-extension.openFeedback",
  openFeedbackPR: "classroom50-vscode-extension.openFeedbackPR",
  openSupportLinks: "classroom50-vscode-extension.openSupportLinks",
  submitAssignment: "classroom50-vscode-extension.submitAssignment",
  selectOrganization: "classroom50-vscode-extension.selectOrganization",
  selectAssignment: "classroom50-vscode-extension.selectAssignment",
  loadStudents: "classroom50-vscode-extension.loadStudents",
  toggleAllStudents: "classroom50-vscode-extension.toggleAllStudents",
  openStudentRepo: "classroom50-vscode-extension.openStudentRepo",
  sendAnnouncement: "classroom50-vscode-extension.sendAnnouncement",
  signIn: "classroom50-vscode-extension.signIn",
  refreshAssignments: "classroom50-vscode-extension.refreshAssignments",
  acceptAssignment: "classroom50-vscode-extension.acceptAssignment",
  cloneAssignment: "classroom50-vscode-extension.cloneAssignment",
  openAssignment: "classroom50-vscode-extension.openAssignment",
} as const;

// Higher priority places the item further left among right-aligned items.
export const STATUS_BAR_PRIORITY = {
  unread: 2000,
  checkFeedback: 1999,
  openFeedbackPR: 1998,
  supportLinks: 1997,
  submitAssignment: 1996,
} as const;

// Button labels in English; they are translated with t() where they are shown.
export const ACTIONS = {
  viewOnGitHub: "View on GitHub",
  openFeedback: "Open feedback",
  send: "Send",
  submit: "Submit",
  installGuide: "Installation guide",
  viewAutograder: "View autograder run",
  manageTrust: "Manage Workspace Trust",
  accept: "Accept",
} as const;

export const ANNOUNCEMENT_PLACEHOLDER =
  "<!-- Write your announcement below. Do not delete this line. -->";
