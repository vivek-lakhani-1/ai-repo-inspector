import { afterAll, describe, expect, it } from "vitest";
import { reviewRepository } from "../src/core.js";
import { addFeatureCommit, cleanupTempDirs, initRepo } from "./helpers.js";

afterAll(cleanupTempDirs);

describe("reviewRepository", () => {
  it("produces a markdown report by default", async () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);

    const outcome = await reviewRepository({ repositoryPath: dir });
    expect(outcome.report).toContain("# Review Report:");
    expect(outcome.report).toContain(dir);
    expect(outcome.report).toContain(`${fileName} \` (added)`);
    expect(outcome.failedValidations).toBe(0);
  });

  it("honors format json with parseable output", async () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);

    const outcome = await reviewRepository({ repositoryPath: dir, format: "json" });
    const parsed = JSON.parse(outcome.report);
    expect(parsed.repositoryPath).toBe(dir);
    expect(parsed.changedFiles).toContainEqual({ path: fileName, status: "added" });
  });

  it("counts failed validations and keeps their output in the report", async () => {
    const dir = initRepo();
    addFeatureCommit(dir);

    const outcome = await reviewRepository({
      repositoryPath: dir,
      validationCommands: [`node -e "console.error('lint broke'); process.exit(1)"`],
    });
    expect(outcome.failedValidations).toBe(1);
    expect(outcome.report).toContain("FAILED");
    expect(outcome.report).toContain("lint broke");
  });

  it("counts only the failing commands in a mixed run", async () => {
    const dir = initRepo();
    addFeatureCommit(dir);

    const outcome = await reviewRepository({
      repositoryPath: dir,
      validationCommands: [
        `node -e "process.exit(0)"`,
        `node -e "process.exit(1)"`,
        `node -e "process.exit(0)"`,
      ],
    });
    expect(outcome.failedValidations).toBe(1);
  });

  it("passes an explicit baseRef through to the diff", async () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);

    // main is the branch point; diffing feature...feature yields nothing.
    const againstSelf = await reviewRepository({ repositoryPath: dir, baseRef: "feature" });
    expect(againstSelf.report).toContain("No changed files detected");

    const againstMain = await reviewRepository({ repositoryPath: dir, baseRef: "main" });
    expect(againstMain.report).toContain(`${fileName} \` (added)`);
  });
});
