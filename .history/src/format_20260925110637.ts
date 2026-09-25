import { GitHubComment, RepoInfo } from "./types";

export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\n/g, " ")
    .trim();
}

export function formatCommentLocation(
  comment: GitHubComment,
): string | undefined {
  if (!comment.path) {
    return undefined;
  }
  const fileName = comment.path.split("/").pop();
  return `${fileName}:${comment.line ?? "?"}`;
}

export function formatCommentTitle(
  comment: GitHubComment,
  assignmentName: string,
): string {
  const title = `💬 New feedback — ${assignmentName}`;
  const location = formatCommentLocation(comment);
  return location ? `${title}\n📍 ${location}` : title;
}

export function repoUrl(repoInfo: RepoInfo): string {
  return `https://github.com/${repoInfo.org}/${repoInfo.repo}`;
}

export function feedbackPRUrl(repoInfo: RepoInfo, prNumber: number): string {
  return `${repoUrl(repoInfo)}/pull/${prNumber}`;
}
