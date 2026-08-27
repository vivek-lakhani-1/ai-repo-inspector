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
 * Escape C0 control characters and DEL as visible \xNN sequences. An inline
 * code span is a single-line construct, so a raw newline in the text (Unix
 * filenames may contain one, and `-z` git output preserves it) would end the
 * block and let following lines be parsed as top-level markdown, escaping the
 * span entirely. Iterating by code point keeps astral characters intact.
 */
function escapeControlChars(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : char;
  }
  return out;
}

/**
 * Wrap arbitrary text (a command, a file path, a repo path) in an inline code
 * span whose delimiter is longer than any backtick run inside it, with the
 * CommonMark padding space so leading/trailing backticks are literal. Control
 * characters are escaped so the value cannot break out of its single line.
 */
function inlineCode(text: string): string {
  const escaped = escapeControlChars(text);
  const delimiter = "`".repeat(longestBacktickRun(escaped) + 1);
  return `${delimiter} ${escaped} ${delimiter}`;
}

export function markdownReport(input: ReportInput): string {
  // repositoryPath is attacker-controlled over MCP (repo_path); neutralize it
  // in the H1 the same way as file paths and commands.
  const lines = [`# Review Report: ${inlineCode(input.repositoryPath)}`, "", "## Changed files"];
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
