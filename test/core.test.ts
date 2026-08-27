import { afterAll, describe, expect, it } from "vitest";
import { reviewRepository } from "../src/core.js";
import { addFeatureCommit, cleanupTempDirs, initRepo } from "./helpers.js";

afterAll(cleanupTempDirs);

describe("reviewRepository", () => {
  it("produces a markdown report by default", async () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);

    const outcome = await reviewRepository({ repositoryPath: dir });
    expect(outcome.report).toContain(`# Review Report: ${dir}`);
    expect(outcome.report).toContain(`${fileName} (added)`);
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
});
