import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { CONFIG_FILE_NAME } from "./constants";
import { ExtensionConfig, RepoInfo } from "./types";

function validateConfig(data: Record<string, unknown>): string | undefined {
  const assignmentName = data["assignment-name"];
  if (typeof assignmentName !== "string" || assignmentName.length === 0) {
    return 'missing or invalid "assignment-name"';
  }

  const pollingInterval = data["polling-interval-minutes"];
  if (typeof pollingInterval !== "number" || pollingInterval <= 0) {
    return 'missing or invalid "polling-interval-minutes"';
  }

  if (!Array.isArray(data["notify-from-users"])) {
    return 'missing or invalid "notify-from-users" (must be an array)';
  }

  const supportLinks = data["support-links"];
  if (
    supportLinks !== undefined &&
    (typeof supportLinks !== "object" || supportLinks === null)
  ) {
    return 'invalid "support-links" (must be an object)';
  }

  return undefined;
}

export function loadConfig(workspacePath: string): ExtensionConfig | undefined {
  const configPath = path.join(workspacePath, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    vscode.window.showErrorMessage(
      `Classroom 50: ${CONFIG_FILE_NAME} file is invalid JSON.`,
    );
    return undefined;
  }

  const validationError = validateConfig(data);
  if (validationError) {
    vscode.window.showErrorMessage(
      `Classroom 50: ${CONFIG_FILE_NAME} is invalid — ${validationError}.`,
    );
    return undefined;
  }

  return {
    ...(data as unknown as ExtensionConfig),
    "support-links": (data["support-links"] as Record<string, string>) ?? {},
  };
}

export function parseGitRemote(workspacePath: string): RepoInfo | undefined {
  let remoteUrl: string;
  try {
    remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: workspacePath,
    })
      .toString()
      .trim();
  } catch {
    vscode.window.showErrorMessage(
      "Classroom 50: open folder is not a git repository.",
    );
    return undefined;
  }

  const match =
    remoteUrl.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/) ??
    remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/);

  if (!match) {
    vscode.window.showErrorMessage(
      "Classroom 50: could not identify the GitHub repository.",
    );
    return undefined;
  }

  return { org: match[1], repo: match[2] };
}
