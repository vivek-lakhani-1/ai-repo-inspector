# Repository Inspector

This is a small TypeScript developer tool that inspects changes in a Git
repository, runs optional validation commands, and produces a Markdown report.
It can be used from a command line or exposed to AI clients through MCP.

## Your task

Investigate the repository and improve it as you judge best. The starter works
for a narrow happy path, but production use may expose correctness, safety,
reliability, contract, output, documentation, or testing weaknesses.

You are not expected to finish everything. We care about how you investigate,
prioritize, implement, verify, and explain a meaningful scope.

## Product decision

This tool may be used directly by developers and by AI coding agents. Decide
whether its production interface should be **CLI-first**, **MCP-first**, or
**hybrid**. Implement improvements consistent with your decision.

There is no preferred label. Explain:

- The primary user and execution environment you assumed.
- The trust boundary and allowed capabilities.
- Reliability, discoverability, latency/context, and output-size tradeoffs.
- How the interfaces you continue to advertise stay behaviorally consistent.
- What evidence would change your decision.

## Time and rules

- Maximum **90 focused minutes** within 48 hours of receiving the invitation.
- Use AI coding tools freely. Verify their work and document at least one
  suggestion you corrected or rejected.
- Work in your own repository created from this template.
- Commit as you work and complete `SUBMISSION.md` in your final commit.
- Completion is not required. Accurate scope and verification matter more than
  a large diff.

## Setup

Requires Node 20.12+ (see `engines` in `package.json`).

```bash
npm install
npm run typecheck
npm test
```

## CLI

```bash
npm run inspector -- review --repo ./path/to/repo
npm run inspector -- review --repo ./path/to/repo --format json
npm run inspector -- review --repo ./path/to/repo --base-ref origin/main --validate "npm test"
```

- `--repo <path>` (required): repository to inspect. Paths containing spaces
  are supported.
- `--base-ref <ref>`: base to diff against (`<base>...HEAD`). Defaults to the
  repository's default branch: `origin/HEAD`, then `main`, then `master`.
- `--format markdown|json`: report format. Markdown is written to
  `review-report.md`, JSON to `review-report.json`, in the current working
  directory.
- `--validate "<command>"` (repeatable): shell command run inside the
  repository. A failing command is recorded in the report as FAILED instead
  of aborting the review. Each command has a 5-minute timeout and a 64 KiB
  output cap.

Changed-file statuses: `added`, `modified`, `deleted`, `renamed` (reported
under the new path), `untracked`. Copies are reported as `added`; any other
git status code (type change, unmerged) is reported as `modified`. Paths are
read NUL-delimited, so non-ASCII and space-bearing filenames are preserved
verbatim.

Exit codes: `0` on success; `1` on a usage error, a git error, or when at
least one validation command failed (so the CLI can gate CI).

## MCP

Start the stdio server with:

```bash
npm run mcp-server
```

It exposes one tool, `review_repository`, with inputs `repo_path` (required),
`base_ref`, and `validation_commands` — the same review the CLI runs, returned
as Markdown text.

MCP clients sit outside the trust boundary, and `validation_commands` are
arbitrary shell execution. They are therefore rejected unless the operator
launching the server explicitly opts in:

```bash
INSPECTOR_ALLOW_VALIDATION=1 npm run mcp-server
```

Bad inputs (missing path, unknown ref) come back as tool errors with a
one-line message rather than a crashed server or a stack trace.

## Project layout

```text
src/core.ts         shared review orchestration
src/cli.ts          command-line adapter
src/mcp.ts          MCP server factory (tool contract lives here)
src/mcp-server.ts   MCP stdio entry point
src/git.ts          Git inspection
src/validation.ts   validation execution
src/report.ts       Markdown/JSON report generation
src/types.ts        shared data types
test/               tests (unit + CLI/MCP integration)
```

When finished, submit via **Security → Report a vulnerability** on this
repo — see `SECURITY.md` for exactly what to include. Do not reply by email;
that submission channel is not monitored.