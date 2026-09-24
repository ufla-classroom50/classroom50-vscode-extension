export const CONFIG_FILE_NAME = ".c50extension.json";
export const FEEDBACK_PR_TITLE = "Feedback";
export const MAX_PAGES = 20;

export const COMMANDS = {
  checkFeedback: "classroom50-vscode-extension.checkFeedback",
  openFeedbackPR: "classroom50-vscode-extension.openFeedbackPR",
  openSupportLinks: "classroom50-vscode-extension.openSupportLinks",
  listStudents: "classroom50-vscode-extension.listStudents",
  sendAnnouncement: "classroom50-vscode-extension.sendAnnouncement",
} as const;

export const STATUS_BAR_PRIORITY = {
  unread: 2000,
  checkFeedback: 1999,
  openFeedbackPR: 1998,
  supportLinks: 1997,
  listStudents: 1996,
  sendAnnouncement: 1995,
} as const;

export const ACTIONS = {
  viewOnGitHub: "View on GitHub",
  markAsRead: "Mark as read",
  send: "Send",
} as const;

export const ANNOUNCEMENT_PLACEHOLDER =
  "<!-- Write your announcement below. Do not delete this line. -->";
