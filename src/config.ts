import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { CONFIG_FILE_NAME } from "./constants";
import { ExtensionConfig, RepoInfo } from "./types";
import { t } from "./i18n";

function validateConfig(data: Record<string, unknown>): string | undefined {
  const assignmentName = data["assignment-name"];
  if (typeof assignmentName !== "string" || assignmentName.length === 0) {
    return t('missing or invalid "assignment-name"');
  }

  const pollingInterval = data["polling-interval-minutes"];
  if (
    typeof pollingInterval !== "number" ||
    !Number.isFinite(pollingInterval) ||
    pollingInterval <= 0
  ) {
    return t('missing or invalid "polling-interval-minutes"');
  }

  const notifyFromUsers = data["notify-from-users"];
  if (
    !Array.isArray(notifyFromUsers) ||
    !notifyFromUsers.every((user) => typeof user === "string")
  ) {
    return t('missing or invalid "notify-from-users" (must be an array)');
  }

  const supportLinks = data["support-links"];
  if (
    supportLinks !== undefined &&
    (typeof supportLinks !== "object" || supportLinks === null)
  ) {
    return t('invalid "support-links" (must be an object)');
  }
  if (
    supportLinks !== undefined &&
    !Object.values(supportLinks).every((link) => typeof link === "string")
  ) {
    return t('invalid "support-links" (all links must be strings)');
  }

  const autograder = data["autograder"];
  if (autograder !== undefined && typeof autograder !== "boolean") {
    return t('invalid "autograder" (must be true or false)');
  }

  return undefined;
}

export function hasConfigFile(workspacePath: string): boolean {
  return fs.existsSync(path.join(workspacePath, CONFIG_FILE_NAME));
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
      t("Classroom 50: {0} file is invalid JSON.", CONFIG_FILE_NAME),
    );
    return undefined;
  }

  const validationError = validateConfig(data);
  if (validationError) {
    vscode.window.showErrorMessage(
      t("Classroom 50: {0} is invalid — {1}.", CONFIG_FILE_NAME, validationError),
    );
    return undefined;
  }

  return {
    ...(data as unknown as ExtensionConfig),
    "support-links": (data["support-links"] as Record<string, string>) ?? {},
    autograder: (data["autograder"] as boolean | undefined) ?? false,
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
      t("Classroom 50: open folder is not a git repository."),
    );
    return undefined;
  }

  const match =
    remoteUrl.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/) ??
    remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/);

  if (!match) {
    vscode.window.showErrorMessage(
      t("Classroom 50: could not identify the GitHub repository."),
    );
    return undefined;
  }

  return { org: match[1], repo: match[2] };
}