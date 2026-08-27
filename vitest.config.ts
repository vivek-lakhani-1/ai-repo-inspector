import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // src/mcp-server.ts is the stdio entry shim (McpServer + transport wiring);
      // its logic lives in src/mcp.ts, which is covered. It can only run as a
      // spawned process, so exclude it from coverage rather than chase it.
      exclude: ["src/mcp-server.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});
