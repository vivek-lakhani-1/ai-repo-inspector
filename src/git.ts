import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ChangedFile } from "./types.js";

/** Raised for any git failure so adapters can print a clean message instead of a stack trace. */
export class GitError extends Error {}

const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;

// The target repo is data, not a trusted environment: its own .git/config can
// name programs git would execute (core.fsmonitor). Disable that for every call.
const HARDENING_ARGS = ["-c", "core.fsmonitor=false"];

function execGit(repositoryPath: string, args: string[], trimOutput: boolean): string {
  try {
    const output = execFileSync("git", [...HARDENING_ARGS, ...args], {
      cwd: repositoryPath,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return trimOutput ? output.trim() : output;
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    throw new GitError(
      `git ${args[0]} failed in "${repositoryPath}"${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

const git = (repositoryPath: string, args: string[]): string =>
  execGit(repositoryPath, args, true);

// NUL-delimited output must not be trimmed: a path may begin or end with spaces.
const gitRaw = (repositoryPath: string, args: string[]): string =>
  execGit(repositoryPath, args, false);

function tryGit(repositoryPath: string, args: string[]): string | undefined {
  try {
    return git(repositoryPath, args);
  } catch {
    return undefined;
  }
}

function refExists(repositoryPath: string, ref: string): boolean {
  return tryGit(repositoryPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined;
}

/**
 * Resolve the base ref to diff against. An explicit baseRef must exist; otherwise
 * fall back to the remote default branch, then local main/master.
 */
export function resolveBaseRef(repositoryPath: string, baseRef?: string): string {
  if (baseRef) {
    if (!refExists(repositoryPath, baseRef)) {
      throw new GitError(`Base ref "${baseRef}" not found in "${repositoryPath}".`);
    }
    return baseRef;
  }
  const originHead = tryGit(repositoryPath, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  for (const candidate of [originHead, "main", "master"]) {
    if (candidate && refExists(repositoryPath, candidate)) {
      return candidate;
    }
  }
  throw new GitError(
    `Could not determine a base branch in "${repositoryPath}" (tried origin/HEAD, main, master). Pass an explicit base ref.`,
  );
}

/**
 * Parse NUL-delimited `git diff --name-status -z` output. Newline parsing would
 * see C-quoted strings for non-ASCII/quoted paths (core.quotePath); with -z,
 * paths arrive verbatim. Rename/copy records carry two paths.
 */
export function parseNameStatus(output: string): ChangedFile[] {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const files: ChangedFile[] = [];
  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index++] ?? "";
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      files.push({
        path: newPath ?? oldPath ?? "",
        status: code.startsWith("R") ? ("renamed" as const) : ("added" as const),
      });
    } else {
      const status =
        code === "A" ? ("added" as const) : code === "D" ? ("deleted" as const) : ("modified" as const);
      files.push({ path: tokens[index++] ?? "", status });
    }
  }
  return files;
}

export function changedFiles(repositoryPath: string, baseRef?: string): ChangedFile[] {
  if (!existsSync(repositoryPath)) {
    throw new GitError(`Repository path does not exist: "${repositoryPath}".`);
  }
  if (tryGit(repositoryPath, ["rev-parse", "--git-dir"]) === undefined) {
    throw new GitError(`Not a git repository: "${repositoryPath}".`);
  }
  const base = resolveBaseRef(repositoryPath, baseRef);
  const diff = gitRaw(repositoryPath, [
    "diff",
    "--name-status",
    "-z",
    "-M",
    "--no-ext-diff",
    `${base}...HEAD`,
  ]);
  const files = parseNameStatus(diff);
  const untracked = gitRaw(repositoryPath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const path of untracked.split("\0").filter(Boolean)) {
    files.push({ path, status: "untracked" });
  }
  return files;
}
