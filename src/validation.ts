import { exec } from "node:child_process";
import type { ValidationResult } from "./types.js";

export type ValidationOptions = {
  /** Kill a validation command after this long. Defaults to 5 minutes. */
  timeoutMs?: number;
  /** Cap the captured output per command. Defaults to 64 KiB. */
  maxOutputChars?: number;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_CHARS = 64 * 1024;

function truncate(output: string, maxChars: number): string {
  if (output.length <= maxChars) {
    return output;
  }
  return `${output.slice(0, maxChars)}\n[output truncated: ${output.length - maxChars} characters omitted]`;
}

/**
 * Run one validation command. A failing or timed-out command is a result
 * (status "failed"), never a thrown error: one broken check must not abort
 * the whole review, and its output is exactly what the reader needs to see.
 */
export function runValidation(
  command: string,
  cwd: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = [stdout, stderr].filter((part) => part.trim().length > 0).join("\n");
      let output = combined;
      if (error) {
        const reason = error.killed
          ? `[command killed after exceeding ${timeoutMs}ms timeout]`
          : `[exit code: ${error.code ?? "unknown"}]`;
        output = combined.length > 0 ? `${combined}\n${reason}` : `${error.message}\n${reason}`;
      }
      resolve({
        command,
        status: error ? "failed" : "passed",
        output: truncate(output, maxOutputChars),
      });
    });
  });
}

export async function runValidations(
  commands: string[],
  cwd: string,
  options: ValidationOptions = {},
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const command of commands) {
    results.push(await runValidation(command, cwd, options));
  }
  return results;
}
