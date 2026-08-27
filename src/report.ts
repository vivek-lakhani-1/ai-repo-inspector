import type { ChangedFile, ValidationResult } from "./types.js";

export type ReportInput = {
  repositoryPath: string;
  changedFiles: ChangedFile[];
  validationResults: ValidationResult[];
};

function longestBacktickRun(content: string): number {
  return content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
}

/**
 * A block fence longer than any backtick run inside the content, so command
 * output can never break out of its block and inject markdown (or instructions
 * to an AI client reading the report) into the report body.
 */
function fenceFor(content: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
}

/**
 * Wrap arbitrary text (a command, a file path) in an inline code span whose
 * delimiter is longer than any backtick run inside it, with the CommonMark
 * padding space so leading/trailing backticks are literal. Neutralizes markdown
 * and prevents the text from escaping into surrounding headings/list items.
 */
function inlineCode(text: string): string {
  const delimiter = "`".repeat(longestBacktickRun(text) + 1);
  return `${delimiter} ${text} ${delimiter}`;
}

export function markdownReport(input: ReportInput): string {
  const lines = [`# Review Report: ${input.repositoryPath}`, "", "## Changed files"];
  if (input.changedFiles.length === 0) {
    lines.push("_No changed files detected._");
  }
  for (const file of input.changedFiles) {
    // File paths come from the inspected repo (attacker-controlled content);
    // code-span them so an exotic filename cannot inject markdown.
    lines.push(`- ${inlineCode(file.path)} (${file.status})`);
  }
  lines.push("", "## Validation results");
  if (input.validationResults.length === 0) {
    lines.push("_No validation commands were run._");
  }
  for (const result of input.validationResults) {
    const label = result.status === "passed" ? "passed" : "FAILED";
    const fence = fenceFor(result.output);
    lines.push(`### ${inlineCode(result.command)} — ${label}`, fence, result.output, fence);
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
