import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("keeps repository paths containing spaces intact", () => {
    const args = parseArgs(["review", "--repo", "/Users/dev/My Projects/repo"]);
    expect(args.repositoryPath).toBe("/Users/dev/My Projects/repo");
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
