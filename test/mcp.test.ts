import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { ALLOW_VALIDATION_ENV, allowValidationFromEnv, createServer, type McpOptions } from "../src/mcp.js";
import { addFeatureCommit, cleanupTempDirs, initRepo } from "./helpers.js";

afterAll(cleanupTempDirs);

async function connectedClient(options: McpOptions = {}): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(options);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((item) => item.text ?? "").join("\n");
}

describe("review_repository over MCP", () => {
  it("advertises the same input contract the handler reads (repo_path, base_ref, validation_commands)", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "review_repository");
    expect(tool).toBeDefined();
    const properties = Object.keys(tool?.inputSchema.properties ?? {});
    expect(properties).toEqual(
      expect.arrayContaining(["repo_path", "base_ref", "validation_commands"]),
    );
    expect(tool?.inputSchema.required).toEqual(["repo_path"]);
  });

  it("reviews the repository named by repo_path, not the server's cwd", async () => {
    const dir = initRepo();
    const fileName = addFeatureCommit(dir);
    const client = await connectedClient();

    const result = await client.callTool({
      name: "review_repository",
      arguments: { repo_path: dir },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(`# Review Report: ${dir}`);
    expect(textOf(result)).toContain(`${fileName} \` (added)`);
  });

  it("rejects validation_commands unless the operator opted in", async () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    const client = await connectedClient();

    const result = await client.callTool({
      name: "review_repository",
      arguments: { repo_path: dir, validation_commands: ["echo pwned"] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("INSPECTOR_ALLOW_VALIDATION");
  });

  it("runs validation_commands when the operator opted in", async () => {
    const dir = initRepo();
    addFeatureCommit(dir);
    const client = await connectedClient({ allowValidationCommands: true });

    const result = await client.callTool({
      name: "review_repository",
      arguments: {
        repo_path: dir,
        validation_commands: [`node -e "console.log('validation ran')"`],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("validation ran");
    expect(textOf(result)).toContain("passed");
  });

  it("enables validation only when INSPECTOR_ALLOW_VALIDATION is exactly \"1\"", () => {
    expect(ALLOW_VALIDATION_ENV).toBe("INSPECTOR_ALLOW_VALIDATION");
    expect(allowValidationFromEnv({ INSPECTOR_ALLOW_VALIDATION: "1" })).toBe(true);
    expect(allowValidationFromEnv({ INSPECTOR_ALLOW_VALIDATION: "true" })).toBe(false);
    expect(allowValidationFromEnv({ INSPECTOR_ALLOW_VALIDATION: "0" })).toBe(false);
    expect(allowValidationFromEnv({})).toBe(false);
  });

  it("returns a clean tool error for a bad repository path", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "review_repository",
      arguments: { repo_path: "/nonexistent/path/xyz" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not exist");
  });
});
