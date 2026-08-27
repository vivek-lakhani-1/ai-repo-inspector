#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allowValidationFromEnv, createServer } from "./mcp.js";

const server = createServer({
  allowValidationCommands: allowValidationFromEnv(process.env),
});
await server.connect(new StdioServerTransport());
