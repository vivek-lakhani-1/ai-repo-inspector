#!/usr/bin/env node
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reviewRepository } from "./core.js";
import { GitError } from "./git.js";

export type Args = {
  command: string;
  repositoryPath?: string;
  baseRef?: string;
  format: "markdown" | "json";
  validations: string[];
  errors: string[];
};

const USAGE =
  "Usage: inspector review --repo <path> [--base-ref <ref>] [--format markdown|json] [--validate <command>]...";

export function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0] ?? "", format: "markdown", validations: [], errors: [] };
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === "--repo" || token === "--base-ref" || token === "--format" || token === "--validate") {
      if (value === undefined || value.startsWith("--")) {
        args.errors.push(`Missing value for ${token}.`);
        continue;
      }
      index++;
      if (token === "--repo") {
        args.repositoryPath = value;
      } else if (token === "--base-ref") {
        args.baseRef = value;
      } else if (token === "--validate") {
        args.validations.push(value);
      } else if (value === "markdown" || value === "json") {
        args.format = value;
      } else {
        args.errors.push(`Invalid --format "${value}" (expected markdown or json).`);
      }
    } else {
      args.errors.push(`Unknown argument: ${token}.`);
    }
  }
  return args;
}

/**
 * Run the CLI and return the process exit code. argv/cwd are injectable so the
 * whole command is testable in-process without mutating process globals; the
 * report file is written relative to cwd.
 */
export async function main(argv: string[] = process.argv.slice(2), cwd: string = process.cwd()): Promise<number> {
  const args = parseArgs(argv);
  if (args.command !== "review" || !args.repositoryPath || args.errors.length > 0) {
    for (const error of args.errors) {
      console.error(error);
    }
    console.error(USAGE);
    return 1;
  }

  try {
    const { report, failedValidations } = await reviewRepository({
      repositoryPath: args.repositoryPath,
      baseRef: args.baseRef,
      validationCommands: args.validations,
      format: args.format,
    });
    const outputFile = args.format === "json" ? "review-report.json" : "review-report.md";
    writeFileSync(join(cwd, outputFile), report, "utf8");
    console.log(`Review report written to ${outputFile}`);
    if (failedValidations > 0) {
      console.error(`${failedValidations} validation command(s) failed; see the report for output.`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof GitError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

/**
 * True when this module is the process entry point. Node resolves an ESM
 * entry to its real path, so when the bin is invoked through npm's symlink
 * (node_modules/.bin/inspector) argv[1] is the symlink; compare real paths.
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) {
    return false;
  }
  try {
    return moduleUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

/* c8 ignore start -- process entry glue; behavior is covered by cli-main.test.ts via a real subprocess */
if (isMainModule(process.argv[1], import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
