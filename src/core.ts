import { changedFiles } from "./git.js";
import { jsonReport, markdownReport } from "./report.js";
import type { ReviewRequest } from "./types.js";
import { runValidations } from "./validation.js";

export type ReviewOutcome = {
  report: string;
  failedValidations: number;
};

export async function reviewRepository(request: ReviewRequest): Promise<ReviewOutcome> {
  const files = changedFiles(request.repositoryPath, request.baseRef);
  const validations = await runValidations(
    request.validationCommands ?? [],
    request.repositoryPath,
  );
  const input = {
    repositoryPath: request.repositoryPath,
    changedFiles: files,
    validationResults: validations,
  };
  return {
    report: request.format === "json" ? jsonReport(input) : markdownReport(input),
    failedValidations: validations.filter((result) => result.status === "failed").length,
  };
}
