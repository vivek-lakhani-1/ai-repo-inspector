import { describe, expect, it } from "vitest";
import { runValidation, runValidations } from "../src/validation.js";

const cwd = process.cwd();

describe("runValidation", () => {
  it("captures stdout for a passing command", async () => {
    const result = await runValidation(`node -e "console.log('all good')"`, cwd);
    expect(result.status).toBe("passed");
    expect(result.output).toContain("all good");
  });

  it("reports a failing command as a failed result instead of throwing", async () => {
    const result = await runValidation(
      `node -e "console.error('boom'); process.exit(2)"`,
      cwd,
    );
    expect(result.status).toBe("failed");
    expect(result.output).toContain("boom");
    expect(result.output).toContain("[exit code: 2]");
  });

  it("keeps stderr even when stdout is present", async () => {
    const result = await runValidation(
      `node -e "console.log('to stdout'); console.error('to stderr')"`,
      cwd,
    );
    expect(result.output).toContain("to stdout");
    expect(result.output).toContain("to stderr");
  });

  it("kills a hanging command after the timeout", async () => {
    const result = await runValidation(
      `node -e "setTimeout(() => {}, 30000)"`,
      cwd,
      { timeoutMs: 300 },
    );
    expect(result.status).toBe("failed");
    expect(result.output).toContain("timeout");
  });

  it("truncates oversized output with a marker", async () => {
    const result = await runValidation(
      `node -e "process.stdout.write('x'.repeat(5000))"`,
      cwd,
      { maxOutputChars: 100 },
    );
    expect(result.status).toBe("passed");
    expect(result.output).toContain("[output truncated:");
    expect(result.output.length).toBeLessThan(300);
  });
});

describe("runValidations", () => {
  it("continues past a failing command and preserves order", async () => {
    const results = await runValidations(
      [`node -e "process.exit(1)"`, `node -e "console.log('second ran')"`],
      cwd,
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe("failed");
    expect(results[1]?.status).toBe("passed");
    expect(results[1]?.output).toContain("second ran");
  });
});
