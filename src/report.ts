import type { ChangedFile, ValidationResult } from "./types.js";

export type ReportInput = {
  repositoryPath: string;
  changedFiles: ChangedFile[];
  validationResults: ValidationResult[];
};

/**
 * Pick a code fence longer than any backtick run inside the content, so
 * command output can never break out of its block and inject markdown
 * (or instructions to an AI client reading the report) into the report body.
 */
function fenceFor(content: string): string {
  const longestRun = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  return "`".repeat(Math.max(3, longestRun + 1));
}

export function markdownReport(input: ReportInput): string {
  const lines = [`# Review Report: ${input.repositoryPath}`, "", "## Changed files"];
  if (input.changedFiles.length === 0) {
    lines.push("_No changed files detected._");
  }
  for (const file of input.changedFiles) {
    lines.push(`- ${file.path} (${file.status})`);
  }
  lines.push("", "## Validation results");
  if (input.validationResults.length === 0) {
    lines.push("_No validation commands were run._");
  }
  for (const result of input.validationResults) {
    const label = result.status === "passed" ? "passed" : "FAILED";
    const command = result.command.includes("`") ? result.command : `\`${result.command}\``;
    const fence = fenceFor(result.output);
    lines.push(`### ${command} — ${label}`, fence, result.output, fence);
  }
  return lines.join("\n");
}

export function jsonReport(input: ReportInput): string {
  return JSON.stringify(
    {
      repositoryPath: input.repositoryPath,
      changedFiles: input.changedFiles,
      validationResults: input.validationResults,
    },
    null,
    2,
  );
}
