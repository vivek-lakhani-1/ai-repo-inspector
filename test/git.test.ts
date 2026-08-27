import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GitError, changedFiles, parseNameStatus, resolveBaseRef } from "../src/git.js";
import { addFeatureCommit, cleanupTempDirs, cloneRepo, initRepo, runGit } from "./helpers.js";

afterAll(cleanupTempDirs);

const NUL = "\0";

describe("parseNameStatus", () => {
  it("maps added, modified, and deleted records", () => {
    const files = parseNameStatus(["A", "new.ts", "M", "changed.ts", "D", "gone.ts", ""].join(NUL));
    expect(files).toEqual([
      { path: "new.ts", status: "added" },
      { path: "changed.ts", status: "modified" },
      { path: "gone.ts", status: "deleted" },
    ]);
  });

  it("reports the new path for renames and copies", () => {
    const files = parseNameStatus(
      ["R100", "old-name.ts", "new-name.ts", "C75", "source.ts", "copy.ts", ""].join(NUL),
    );
    expect(files).toEqual([
      { path: "new-name.ts", status: "renamed" },
      { path: "copy.ts", status: "added" },
    ]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});

describe("changedFiles", () => {
  it("detects added, modified, deleted, renamed, and untracked files on a feature branch", () => {
    const dir = initRepo("main");
    writeFileSync(join(dir, "c.txt"), "will be deleted\n");
    writeFileSync(join(dir, "d.txt"), "will be renamed, needs stable content\n");
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "more files"]);
    runGit(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\n");
    writeFileSync(join(dir, "b.txt"), "new file\n");
    runGit(dir, ["rm", "-q", "c.txt"]);
    runGit(dir, ["mv", "d.txt", "renamed.txt"]);
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "feature work"]);
    writeFileSync(join(dir, "scratch.txt"), "not committed\n");
    writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(dir, "ignored.txt"), "should not appear\n");

    const files = changedFiles(dir);
    expect(files).toContainEqual({ path: "a.txt", status: "modified" });
    expect(files).toContainEqual({ path: "b.txt", status: "added" });
    expect(files).toContainEqual({ path: "c.txt", status: "deleted" });
    expect(files).toContainEqual({ path: "renamed.txt", status: "renamed" });
    expect(files).toContainEqual({ path: "scratch.txt", status: "untracked" });
    expect(files.map((file) => file.path)).not.toContain("ignored.txt");
  });

  it("reports non-ASCII paths verbatim instead of C-quoted", () => {
    const dir = initRepo();
    runGit(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "café.txt"), "unicode name\n");
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "unicode"]);
    writeFileSync(join(dir, "naïve.txt"), "untracked unicode\n");

    const files = changedFiles(dir);
    expect(files).toContainEqual({ path: "café.txt", status: "added" });
    expect(files).toContainEqual({ path: "naïve.txt", status: "untracked" });
  });

  it("preserves leading/trailing spaces in filenames (no-trim invariant)", () => {
    const dir = initRepo();
    runGit(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, " leading.txt"), "committed\n");
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "spacey"]);
    writeFileSync(join(dir, "trailing.txt "), "untracked\n");

    const files = changedFiles(dir);
    expect(files).toContainEqual({ path: " leading.txt", status: "added" });
    expect(files).toContainEqual({ path: "trailing.txt ", status: "untracked" });
  });

  it("prefers the remote default branch (origin/HEAD) when one exists", () => {
    const upstream = initRepo("main");
    const clone = cloneRepo(upstream);
    runGit(clone, ["checkout", "-b", "feature"]);
    writeFileSync(join(clone, "b.txt"), "new file\n");
    runGit(clone, ["add", "-A"]);
    runGit(clone, ["commit", "-m", "feature work"]);

    expect(resolveBaseRef(clone)).toBe("origin/main");
    expect(changedFiles(clone)).toContainEqual({ path: "b.txt", status: "added" });
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

  it("does not execute fsmonitor commands configured by the target repo", () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    const markerDir = mkdtempSync(join(tmpdir(), "inspector-marker-"));
    const marker = join(markerDir, "pwned");
    // Configure the RCE vector only after setup, so any marker is attributable
    // to changedFiles alone (git ls-files --others invokes core.fsmonitor).
    runGit(dir, ["config", "core.fsmonitor", `touch ${marker}`]);
    try {
      // Positive control: an unhardened ls-files DOES fire the hook.
      runGit(dir, ["ls-files", "--others", "--exclude-standard", "-z"]);
      expect(existsSync(marker)).toBe(true);
      rmSync(marker, { force: true });

      // The hardened path must not.
      changedFiles(dir);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(markerDir, { recursive: true, force: true });
    }
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

  it("fails with a clear error for a directory that is not a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-notrepo-"));
    try {
      expect(() => changedFiles(dir)).toThrowError(/Not a git repository/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
