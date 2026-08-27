#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp.js";

const server = createServer({
  allowValidationCommands: process.env.INSPECTOR_ALLOW_VALIDATION === "1",
});
await server.connect(new StdioServerTransport());
