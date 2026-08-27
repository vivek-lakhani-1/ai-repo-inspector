import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GitError, changedFiles, parseNameStatus, resolveBaseRef } from "../src/git.js";

const tempDirs: string[] = [];

function run(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initRepo(defaultBranch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-git-"));
  tempDirs.push(dir);
  run(dir, ["init", "-b", defaultBranch]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  run(dir, ["add", "-A"]);
  run(dir, ["commit", "-m", "init"]);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseNameStatus", () => {
  it("maps added, modified, and deleted records", () => {
    const files = parseNameStatus("A\tnew.ts\nM\tchanged.ts\nD\tgone.ts");
    expect(files).toEqual([
      { path: "new.ts", status: "added" },
      { path: "changed.ts", status: "modified" },
      { path: "gone.ts", status: "deleted" },
    ]);
  });

  it("reports the new path for renames instead of a tab-joined pair", () => {
    const files = parseNameStatus("R100\told-name.ts\tnew-name.ts");
    expect(files).toEqual([{ path: "new-name.ts", status: "renamed" }]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});

describe("changedFiles", () => {
  it("detects added, modified, renamed, and untracked files on a feature branch", () => {
    const dir = initRepo("main");
    run(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\n");
    writeFileSync(join(dir, "b.txt"), "new file\n");
    run(dir, ["mv", "a.txt", "renamed.txt"]);
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-m", "feature work"]);
    writeFileSync(join(dir, "scratch.txt"), "not committed\n");

    const files = changedFiles(dir);
    expect(files).toContainEqual({ path: "b.txt", status: "added" });
    expect(files).toContainEqual({ path: "renamed.txt", status: "renamed" });
    expect(files).toContainEqual({ path: "scratch.txt", status: "untracked" });
  });

  it("falls back to master when main does not exist", () => {
    const dir = initRepo("master");
    run(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "b.txt"), "new file\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-m", "feature work"]);

    expect(resolveBaseRef(dir)).toBe("master");
    expect(changedFiles(dir)).toContainEqual({ path: "b.txt", status: "added" });
  });

  it("fails with a clear error when no base branch can be determined", () => {
    const dir = initRepo("trunk");
    expect(() => changedFiles(dir)).toThrowError(GitError);
    expect(() => changedFiles(dir)).toThrowError(/Could not determine a base branch/);
    expect(changedFiles(dir, "trunk")).toEqual([]);
  });

  it("fails with a clear error for an unknown base ref", () => {
    const dir = initRepo("main");
    expect(() => changedFiles(dir, "does-not-exist")).toThrowError(/not found/);
  });

  it("fails with a clear error for a missing repository path", () => {
    expect(() => changedFiles("/nonexistent/path/xyz")).toThrowError(/does not exist/);
  });
});
