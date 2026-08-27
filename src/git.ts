import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ChangedFile } from "./types.js";

/** Raised for any git failure so adapters can print a clean message instead of a stack trace. */
export class GitError extends Error {}

const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;

function git(repositoryPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    }).trim();
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

/** Parse `git diff --name-status` output, including rename/copy records. */
export function parseNameStatus(output: string): ChangedFile[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const code = parts[0] ?? "";
      if (code.startsWith("R") || code.startsWith("C")) {
        // Format is `R<score>\t<old path>\t<new path>`; report the new path.
        return {
          path: parts[2] ?? parts[1] ?? "",
          status: code.startsWith("R") ? ("renamed" as const) : ("added" as const),
        };
      }
      const status = code === "A" ? ("added" as const) : code === "D" ? ("deleted" as const) : ("modified" as const);
      return { path: parts.slice(1).join("\t"), status };
    });
}

export function changedFiles(repositoryPath: string, baseRef?: string): ChangedFile[] {
  if (!existsSync(repositoryPath)) {
    throw new GitError(`Repository path does not exist: "${repositoryPath}".`);
  }
  const base = resolveBaseRef(repositoryPath, baseRef);
  const diff = git(repositoryPath, ["diff", "--name-status", "-M", `${base}...HEAD`]);
  const files = parseNameStatus(diff);
  const untracked = git(repositoryPath, ["ls-files", "--others", "--exclude-standard"]);
  for (const path of untracked.split("\n").filter(Boolean)) {
    files.push({ path, status: "untracked" });
  }
  return files;
}
