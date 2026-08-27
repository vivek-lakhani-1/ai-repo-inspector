import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

// Isolate test repos from the developer's global/system git config
// (commit.gpgsign, hooks templates, ...), which could break commits.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
}

function setIdentity(dir: string): void {
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
}

/** Create a throwaway git repo with one commit (a.txt) on the given default branch. */
export function initRepo(defaultBranch = "main"): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-test-"));
  tempDirs.push(dir);
  runGit(dir, ["init", "-b", defaultBranch]);
  setIdentity(dir);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "init"]);
  return dir;
}

/** Clone a repo into a fresh temp dir (giving it a real origin with origin/HEAD). */
export function cloneRepo(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-clone-"));
  tempDirs.push(dir);
  execFileSync("git", ["clone", "--quiet", source, dir], { encoding: "utf8", env: GIT_ENV });
  setIdentity(dir);
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
