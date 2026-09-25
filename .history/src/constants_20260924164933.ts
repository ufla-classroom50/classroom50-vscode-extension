export const CONFIG_FILE_NAME = ".c50extension.json";
export const FEEDBACK_PR_TITLE = "Feedback";
export const CONFIG_REPO_NAME = "classroom50";
export const TEACHER_VIEW_ID = "classroom50.teacherView";
export const MAX_PAGES = 20;
export const AUTOGRADER_CHECK_DELAY_MS = 2 * 60 * 1000;
export const STUDENT_CLI_INSTALL_URL =
  "https://github.com/foundation50/classroom50/wiki/Installation";

export const COMMANDS = {
  checkFeedback: "classroom50-vscode-extension.checkFeedback",
  openFeedbackPR: "classroom50-vscode-extension.openFeedbackPR",
  openSupportLinks: "classroom50-vscode-extension.openSupportLinks",
  submitAssignment: "classroom50-vscode-extension.submitAssignment",
  selectOrganization: "classroom50-vscode-extension.selectOrganization",
  selectAssignment: "classroom50-vscode-extension.selectAssignment",
  loadStudents: "classroom50-vscode-extension.loadStudents",
  toggleAllStudents: "classroom50-vscode-extension.toggleAllStudents",
  openStudentRepo: "classroom50-vscode-extension.openStudentRepo",
  sendAnnouncement: "classroom50-vscode-extension.sendAnnouncement",
} as const;

export const STATUS_BAR_PRIORITY = {
  unread: 2000,
  checkFeedback: 1999,
  openFeedbackPR: 1998,
  supportLinks: 1997,
  submitAssignment: 1996,
} as const;

export const ACTIONS = {
  viewOnGitHub: "View on GitHub",
  markAsRead: "Mark as read",
  send: "Send",
  submit: "Submit",
  installGuide: "Installation guide",
  viewAutograder: "View autograder run",
} as const;

export const ANNOUNCEMENT_PLACEHOLDER =
  "<!-- Write your announcement below. Do not delete this line. -->";
