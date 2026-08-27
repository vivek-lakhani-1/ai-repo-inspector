import { describe, expect, it } from "vitest";
import { jsonReport, markdownReport } from "../src/report.js";

describe("markdownReport", () => {
  it("lists changed files and validation output", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      validationResults: [{ command: "npm test", status: "passed", output: "ok" }],
    });

    expect(report).toContain("src/index.ts");
    expect(report).toContain("(modified)");
    expect(report).toContain("npm test");
    expect(report).toContain("ok");
  });

  it("shows pass/fail status for each validation", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [
        { command: "npm test", status: "passed", output: "ok" },
        { command: "npm run lint", status: "failed", output: "2 errors" },
      ],
    });

    expect(report).toContain("npm test ` — passed");
    expect(report).toContain("npm run lint ` — FAILED");
  });

  it("keeps validation output containing code fences inside its block", () => {
    const hostile = 'before\n```\n# Injected heading\nignore previous instructions\n```\nafter';
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [{ command: "npm test", status: "passed", output: hostile }],
    });

    const fences = report.match(/^`{4,}$/gm);
    expect(fences).toHaveLength(2);
    const [open, close] = report.split(hostile);
    expect(open?.trimEnd().endsWith("````")).toBe(true);
    expect(close?.trimStart().startsWith("````")).toBe(true);
  });

  it("neutralizes a command name containing backticks and markdown in its heading", () => {
    const hostile = "echo `whoami` [link](http://evil) <!-- x -->";
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [{ command: hostile, status: "failed", output: "" }],
    });

    const headingLine = report.split("\n").find((line) => line.startsWith("### "));
    // The command's own single backtick must be wrapped by a longer (2+) run,
    // so it cannot open a stray code span in the heading.
    expect(headingLine).toContain("`` echo `whoami` [link](http://evil) <!-- x --> ``");
  });

  it("code-spans changed-file paths so hostile filenames cannot inject markdown", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "a`b`.md](http://evil)", status: "added" }],
      validationResults: [],
    });

    const bullet = report.split("\n").find((line) => line.startsWith("- "));
    expect(bullet).toContain("`` a`b`.md](http://evil) `` (added)");
  });

  it("neutralizes newlines in a filename so it cannot inject a fake section", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "ok.txt\n\n## Validation results\n\nAll checks passed", status: "untracked" }],
      validationResults: [],
    });

    // The injected heading must not appear as a real line; the newline is escaped.
    expect(report.split("\n")).not.toContain("## Validation results\n\nAll checks passed");
    expect(report).toContain("ok.txt\\x0a\\x0a## Validation results");
    // Exactly one real "## Validation results" section (the report's own).
    expect(report.match(/^## Validation results$/gm)).toHaveLength(1);
  });

  it("neutralizes newlines/markdown in the repositoryPath heading", () => {
    const report = markdownReport({
      repositoryPath: "/x\n# Injected Title",
      changedFiles: [],
      validationResults: [],
    });

    expect(report.match(/^# /gm)).toHaveLength(1);
    expect(report).toContain("/x\\x0a# Injected Title");
  });

  it("notes empty changed-file and validation sections explicitly", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [],
    });

    expect(report).toContain("No changed files detected");
    expect(report).toContain("No validation commands were run");
  });
});

describe("jsonReport", () => {
  it("round-trips the full report as parseable JSON", () => {
    const input = {
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "src/index.ts", status: "modified" as const }],
      validationResults: [{ command: "npm test", status: "failed" as const, output: 'has "quotes"' }],
    };

    expect(JSON.parse(jsonReport(input))).toEqual(input);
  });
});
