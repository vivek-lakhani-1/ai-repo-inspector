import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reviewRepository } from "./core.js";
import { GitError } from "./git.js";

export type McpOptions = {
  /**
   * Operator opt-in for running shell commands on behalf of MCP clients.
   * Off by default: the model on the other side of the transport is outside
   * the trust boundary, and validation commands are arbitrary code execution.
   */
  allowValidationCommands?: boolean;
};

export function createServer(options: McpOptions = {}): McpServer {
  const server = new McpServer({ name: "repository-inspector", version: "2.0.0" });

  server.tool(
    "review_repository",
    "Inspects a Git repository and returns a Markdown review report of changed files and optional validation results.",
    {
      repo_path: z.string().describe("Path of the Git repository to inspect."),
      base_ref: z
        .string()
        .optional()
        .describe(
          "Base ref to diff against. Defaults to the repository's default branch (origin/HEAD, then main, then master).",
        ),
      validation_commands: z
        .array(z.string())
        .optional()
        .describe(
          "Shell commands to run inside the repository. Only honored when the operator started the server with INSPECTOR_ALLOW_VALIDATION=1.",
        ),
    },
    async ({ repo_path, base_ref, validation_commands }) => {
      if (validation_commands && validation_commands.length > 0 && !options.allowValidationCommands) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "validation_commands are disabled on this server. Running shell commands on behalf of an MCP client requires the operator to start the server with INSPECTOR_ALLOW_VALIDATION=1.",
            },
          ],
        };
      }
      try {
        const { report } = await reviewRepository({
          repositoryPath: repo_path,
          baseRef: base_ref,
          validationCommands: validation_commands,
        });
        return { content: [{ type: "text" as const, text: report }] };
      } catch (error) {
        const message =
          error instanceof GitError ? error.message : `Review failed: ${String(error)}`;
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    },
  );

  return server;
}
