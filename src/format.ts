import { Feedback, InlineComment, RepoInfo } from "./types";

export function stripMarkdown(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength
    ? `${text.substring(0, maxLength).trimEnd()}...`
    : text;
}

export function formatInlineLocation(comment: InlineComment): string {
  const fileName = comment.path.split("/").pop();
  return `${fileName}:${comment.line ?? "?"}`;
}

export function formatFeedbackMessage(
  feedback: Feedback,
  assignmentName: string,
): string {
  const parts = [`💬 New feedback from @${feedback.author} — ${assignmentName}`];
  const preview = stripMarkdown(feedback.body);
  if (preview.length > 0) {
    parts.push(truncate(preview, 140));
  }
  if (feedback.inline.length > 0) {
    parts.push(
      `📍 Check inline comments (${feedback.inline.length}), starting at ${formatInlineLocation(feedback.inline[0])}`,
    );
  }
  return parts.join(" \n");
}

export function repoUrl(repoInfo: RepoInfo): string {
  return `https://github.com/${repoInfo.org}/${repoInfo.repo}`;
}

export function feedbackPRUrl(repoInfo: RepoInfo, prNumber: number): string {
  return `${repoUrl(repoInfo)}/pull/${prNumber}`;
}
