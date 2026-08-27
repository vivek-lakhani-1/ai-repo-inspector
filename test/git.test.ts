import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GitError, changedFiles, parseNameStatus, resolveBaseRef } from "../src/git.js";
import { cleanupTempDirs, initRepo, runGit } from "./helpers.js";

afterAll(cleanupTempDirs);

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
    runGit(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\n");
    writeFileSync(join(dir, "b.txt"), "new file\n");
    runGit(dir, ["mv", "a.txt", "renamed.txt"]);
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "feature work"]);
    writeFileSync(join(dir, "scratch.txt"), "not committed\n");

    const files = changedFiles(dir);
    expect(files).toContainEqual({ path: "b.txt", status: "added" });
    expect(files).toContainEqual({ path: "renamed.txt", status: "renamed" });
    expect(files).toContainEqual({ path: "scratch.txt", status: "untracked" });
  });

  it("falls back to master when main does not exist", () => {
    const dir = initRepo("master");
    runGit(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "b.txt"), "new file\n");
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "feature work"]);

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
