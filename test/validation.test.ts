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

  it("does not truncate through a surrogate pair", async () => {
    // 60 astral chars = 120 UTF-16 code units; cut at 101 would split a pair.
    const result = await runValidation(
      `node -e "process.stdout.write('😀'.repeat(60))"`,
      cwd,
      { maxOutputChars: 101 },
    );
    const body = result.output.split("\n[output truncated:")[0] ?? "";
    // Every retained code unit pairs up: no lone surrogate at the boundary.
    expect(/[\uD800-\uDBFF]$/.test(body)).toBe(false);
    expect([...body].every((char) => char === "😀")).toBe(true);
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
