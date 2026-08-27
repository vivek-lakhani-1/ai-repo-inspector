#!/usr/bin/env node
import { writeFileSync } from "node:fs";
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

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
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
    writeFileSync(outputFile, report, "utf8");
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

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exitCode = 1;
    });
}
