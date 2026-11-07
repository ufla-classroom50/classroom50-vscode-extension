/**
 * Text and URL formatting helpers.
 */

import { t } from "./i18n";
import { Feedback, InlineComment, RepoInfo } from "./types";

/** Turns Markdown into plain text for notification previews, which cannot show formatting. */
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

/** "Livro.java:42" — file name and line of a line comment. */
export function formatInlineLocation(comment: InlineComment): string {
  const fileName = comment.path.split("/").pop();
  return `${fileName}:${comment.line ?? "?"}`;
}

/**
 * Text of the notification of a new feedback: author, assignment, a preview of
 * the general text and, when there are line comments, how many and where the
 * first one is.
 */
export function formatFeedbackMessage(
  feedback: Feedback,
  assignmentName: string,
): string {
  const parts = [
    t("💬 New feedback from @{0} — {1}", feedback.author, assignmentName),
  ];
  const preview = stripMarkdown(feedback.body);
  if (preview.length > 0) {
    parts.push(truncate(preview, 140));
  }
  if (feedback.inline.length > 0) {
    parts.push(
      t(
        "📍 Check inline comments ({0}), starting at {1}",
        feedback.inline.length,
        formatInlineLocation(feedback.inline[0]),
      ),
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
