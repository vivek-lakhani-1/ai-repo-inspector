import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

export function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Create a throwaway git repo with one commit on the given default branch. */
export function initRepo(defaultBranch = "main"): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-test-"));
  tempDirs.push(dir);
  runGit(dir, ["init", "-b", defaultBranch]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "init"]);
  return dir;
}

/** Branch off and commit one added file, returning its name. */
export function addFeatureCommit(dir: string, fileName = "b.txt"): string {
  runGit(dir, ["checkout", "-b", "feature"]);
  writeFileSync(join(dir, fileName), "new file\n");
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "feature work"]);
  return fileName;
}

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
