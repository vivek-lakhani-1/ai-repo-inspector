import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { addFeatureCommit, cleanupTempDirs, initRepo } from "./helpers.js";

// These exercise the REAL bin as a spawned process (what `inspector` does when
// installed). The command's branch logic is unit-tested in cli.test.ts; here we
// only cover what an in-process test cannot: actual process invocation and the
// npm-style symlink entry path that the isMainModule guard must handle.
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

describe("cli as a spawned process", () => {
  it("writes a report and exits 0 when run directly", () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);
    const run = runCli(["review", "--repo", dir], dir);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("review-report.md");
    expect(readFileSync(join(dir, "review-report.md"), "utf8")).toContain(`${fileName} \` (added)`);
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
