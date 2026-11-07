/**
 * Synchronizes the local repository with the version just submitted.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Result of the synchronization after a submit:
 * - synced: the local repository matches the submitted version;
 * - dirty: some files changed while submitting (need another submit);
 * - localCommits: the student has commits that are not in the submission,
 *   so nothing is touched and "git pull" is suggested;
 * - noUpstream / failed: nothing could be done; no message is needed.
 */
export type SyncResult =
  | { status: "synced" }
  | { status: "dirty"; changedFiles: number }
  | { status: "localCommits"; commits: number }
  | { status: "noUpstream" }
  | { status: "failed" };

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function getUpstream(cwd: string): Promise<string | undefined> {
  try {
    return await git(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
  } catch {
    return undefined;
  }
}

/**
 * `gh student submit` pushes the files from a temporary clone, without
 * touching the student's local git. Afterwards VS Code would show every
 * submitted file as modified. This function fetches the submitted commit and
 * moves the local branch to it with `git reset --mixed`, which changes only
 * git's history and index, never the files on disk, so no work can be lost.
 * It refuses to do so when the student has local commits of their own.
 */
export async function syncAfterSubmit(cwd: string): Promise<SyncResult> {
  try {
    const upstream = await getUpstream(cwd);
    if (!upstream) {
      return { status: "noUpstream" };
    }

    const remote = upstream.split("/")[0];
    await git(cwd, ["fetch", "--quiet", remote]);

    const aheadCount = Number(
      await git(cwd, ["rev-list", "--count", `${upstream}..HEAD`]),
    );
    if (aheadCount > 0) {
      return { status: "localCommits", commits: aheadCount };
    }

    await git(cwd, ["reset", "--mixed", "--quiet", upstream]);

    const status = await git(cwd, ["status", "--porcelain"]);
    const changedFiles = status.length === 0 ? 0 : status.split("\n").length;
    return changedFiles === 0
      ? { status: "synced" }
      : { status: "dirty", changedFiles };
  } catch (err) {
    console.error("Classroom 50: could not sync repository after submit", err);
    return { status: "failed" };
  }
}
