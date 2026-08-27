import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { addFeatureCommit, cleanupTempDirs, initRepo } from "./helpers.js";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

afterAll(cleanupTempDirs);

type Run = { status: number; stdout: string; stderr: string };

function runCli(args: string[], cwd: string, entry = cliPath): Run {
  try {
    const stdout = execFileSync(tsx, [entry, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("cli main()", () => {
  it("writes a markdown report and exits 0 on success", () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);
    const run = runCli(["review", "--repo", dir], dir);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("review-report.md");
    expect(readFileSync(join(dir, "review-report.md"), "utf8")).toContain(`${fileName} \` (added)`);
  });

  it("writes review-report.json under --format json", () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    const run = runCli(["review", "--repo", dir, "--format", "json"], dir);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("review-report.json");
    const parsed = JSON.parse(readFileSync(join(dir, "review-report.json"), "utf8"));
    expect(parsed.repositoryPath).toBe(dir);
  });

  it("exits 1 and prints usage when the command is missing or wrong", () => {
    const dir = initRepo();
    const run = runCli(["--repo", dir], dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Usage: inspector review");
  });

  it("exits 1 when a validation command fails", () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    const run = runCli(
      ["review", "--repo", dir, "--validate", `node -e "process.exit(3)"`],
      dir,
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("validation command(s) failed");
    expect(readFileSync(join(dir, "review-report.md"), "utf8")).toContain("FAILED");
  });

  it("exits 1 with a clean message (no stack trace) for a bad repo path", () => {
    const dir = initRepo();
    const run = runCli(["review", "--repo", "/nonexistent/path/xyz"], dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("does not exist");
    expect(run.stderr).not.toContain("at ");
  });

  it("still runs when invoked through a symlink (installed-bin path)", () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    const link = join(dir, "inspector-link.ts");
    symlinkSync(cliPath, link);
    try {
      const run = runCli(["review", "--repo", dir], dir, link);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("review-report.md");
    } finally {
      rmSync(link, { force: true });
    }
  });
});
