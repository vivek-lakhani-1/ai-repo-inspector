import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { isMainModule, main, parseArgs } from "../src/cli.js";
import { addFeatureCommit, cleanupTempDirs, initRepo } from "./helpers.js";

describe("parseArgs", () => {
  it("keeps repository paths containing spaces intact", () => {
    const args = parseArgs(["review", "--repo", "/Users/dev/My Projects/repo"]);
    expect(args.repositoryPath).toBe("/Users/dev/My Projects/repo");
    expect(args.errors).toEqual([]);
  });

  it("parses --base-ref into baseRef", () => {
    const args = parseArgs(["review", "--repo", ".", "--base-ref", "origin/main"]);
    expect(args.baseRef).toBe("origin/main");
    expect(args.errors).toEqual([]);
  });

  it("collects multiple --validate commands in order", () => {
    const args = parseArgs(["review", "--repo", ".", "--validate", "npm test", "--validate", "npm run lint"]);
    expect(args.validations).toEqual(["npm test", "npm run lint"]);
  });

  it("accepts json format and defaults to markdown", () => {
    expect(parseArgs(["review", "--repo", "."]).format).toBe("markdown");
    expect(parseArgs(["review", "--repo", ".", "--format", "json"]).format).toBe("json");
  });

  it("rejects an unknown format value", () => {
    const args = parseArgs(["review", "--repo", ".", "--format", "yaml"]);
    expect(args.errors.some((error) => error.includes('--format "yaml"'))).toBe(true);
  });

  it("reports a missing flag value instead of consuming the next flag", () => {
    const args = parseArgs(["review", "--repo", ".", "--validate", "--format", "json"]);
    expect(args.errors).toContainEqual("Missing value for --validate.");
    expect(args.format).toBe("json");
    expect(args.validations).toEqual([]);
  });

  it("reports unknown arguments", () => {
    const args = parseArgs(["review", "--repo", ".", "--frmat", "json"]);
    expect(args.errors.some((error) => error.includes("--frmat"))).toBe(true);
  });
});

describe("main (in-process)", () => {
  afterAll(cleanupTempDirs);
  afterEach(() => vi.restoreAllMocks());

  it("writes a markdown report and returns 0 on success", async () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await main(["review", "--repo", dir], dir);

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith("Review report written to review-report.md");
    expect(readFileSync(join(dir, "review-report.md"), "utf8")).toContain(`${fileName} \` (added)`);
  });

  it("writes review-report.json under --format json", async () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await main(["review", "--repo", dir, "--format", "json"], dir);

    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "review-report.json"), "utf8"));
    expect(parsed.repositoryPath).toBe(dir);
  });

  it("returns 1 and prints usage for a missing/wrong command", async () => {
    const dir = initRepo();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await main(["--repo", dir], dir);

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Usage: inspector review"));
  });

  it("returns 1 when a validation command fails", async () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await main(["review", "--repo", dir, "--validate", `node -e "process.exit(3)"`], dir);

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("validation command(s) failed"));
    expect(readFileSync(join(dir, "review-report.md"), "utf8")).toContain("FAILED");
  });

  it("returns 1 with a clean message (no stack) for a bad repo path", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await main(["review", "--repo", "/nonexistent/path/xyz"], process.cwd());

    expect(code).toBe(1);
    const messages = error.mock.calls.flat().join("\n");
    expect(messages).toContain("does not exist");
    expect(messages).not.toContain("\n    at ");
  });
});

describe("isMainModule", () => {
  const thisFile = fileURLToPath(import.meta.url);

  it("returns false when there is no entry argument", () => {
    expect(isMainModule(undefined, import.meta.url)).toBe(false);
  });

  it("returns false when the entry path does not resolve", () => {
    expect(isMainModule("/nonexistent/entry.js", import.meta.url)).toBe(false);
  });

  it("matches when argv[1] resolves to the module url (including via symlink realpath)", () => {
    expect(isMainModule(thisFile, pathToFileURL(thisFile).href)).toBe(true);
    expect(isMainModule(thisFile, pathToFileURL("/some/other/file.js").href)).toBe(false);
  });
});
