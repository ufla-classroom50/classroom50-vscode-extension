import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
