# Submission

## What did you investigate first, and why?

I read every file in the repo before changing anything (it is ~300 lines, so full coverage was cheap and safer than sampling), then ran the baseline gates (`npm run typecheck`, `npm test`). Two things drove my priorities:

1. The README's hint to "inspect the implementation to determine its current input contract" pointed straight at the MCP adapter. Reading it confirmed the worst bug in the repo: the tool schema advertises `repo_path` but the handler reads `input.repoPath` (hidden from the typechecker by an `any` annotation), so every MCP call reviewed the *server's* working directory instead of the requested repo.
2. The baseline test run crashed on my machine before I had changed a line — which turned out to be an environment issue, not a repo issue (see the blocker section).

From there I traced data flow bottom-up (git → validation → report → core → adapters) and built a priority list: contract-breaking bugs first, then safety, then reliability, then output/docs.

## What did you choose to implement or fix?

In commit order (each commit is one slice with its tests, gates green at every step):

1. **git.ts** — default base assumed `main` exists (now resolves `origin/HEAD` → `main` → `master`, with clear errors for unknown refs/paths); renames produced a tab-joined `old\tnew` path labeled "modified" (now `renamed` with the new path); untracked files were invisible (the `"untracked"` status in types.ts was dead code — now real); git failures were uncaught stack traces (now `GitError` with a one-line message).
2. **validation.ts** — a failing validation command rejected the promise and crashed the whole review (the `"failed"` status was dead code — now a failing command is a reported result); `stdout || stderr` silently dropped stderr (now both); added a 5-minute timeout for hung commands and a 64 KiB output cap with a truncation marker.
3. **report.ts** — pass/fail status was never rendered (now it is); validation output could contain ``` and break out of its fence — a markdown-injection and, over MCP, prompt-injection surface (fences are now computed longer than any backtick run in the content); empty sections are now explicit; added a JSON report.
4. **cli.ts / core.ts** — `--repo` ran through `split(" ")[0]` and truncated any path with a space (removed); missing/unknown flag values now produce errors instead of `undefined` commands; `--format json` was parsed, typed, documented, and ignored — it now works; the CLI exits 1 when validations fail so it can gate CI.
5. **mcp.ts / mcp-server.ts** — fixed the schema/handler contract mismatch, removed `any` so the handler is typed from the zod shape, standardized the contract to `repo_path`/`base_ref`/`validation_commands`, and gated `validation_commands` behind an operator opt-in (`INSPECTOR_ALLOW_VALIDATION=1`) because they are arbitrary shell execution requested by a client outside the trust boundary. Errors return as clean `isError` tool results.
6. **Packaging** — `bin` pointed at `./dist/cli.js` but the build emitted `dist/src/cli.js` (and shipped compiled tests); builds now use a dedicated `tsconfig.build.json`. `engines` claimed `>=20` but vitest 4 needs `util.styleText` (Node 20.12+).
7. **Docs** — README usage sections now describe the real flags, defaults, exit codes, and trust model.

Then I ran an adversarial review pass over my *own* fixes (see the AI-usage section) and hardened the real findings it surfaced:

8. **Config-driven RCE in git handling** — the inspected repo's `.git/config` is attacker-controlled data, and `core.fsmonitor` names a program git runs during `ls-files --others`. Combined with the unconfined MCP `repo_path`, an MCP client could achieve code execution *without* the validation opt-in. Every git call now runs with `-c core.fsmonitor=false`; a test proves an unhardened `ls-files` fires the hook and the hardened path does not.
9. **Mangled paths** — `git diff --name-status` and `ls-files` emit C-quoted strings for non-ASCII/quoted names under `core.quotePath`, and my earlier blanket `.trim()` also ate leading/trailing spaces. Both now read NUL-delimited (`-z`) and parse without trimming.
10. **Inverted heading escaping** — a validation command *containing* backticks (the dangerous case) was emitted raw into a `###` heading while only safe commands were code-spanned. Commands and file paths now go through an `inlineCode` helper that picks a delimiter longer than any backtick run inside.
11. **Installed-bin no-op** — the `isMainModule` guard compared `import.meta.url` (a real path) against `process.argv[1]` (the symlink npm installs as the `inspector` bin), so the installed CLI silently exited 0. Fixed with `realpathSync`.
12. Plus a surrogate-safe truncation fix and a `.gitignore` bug where an earlier edit had concatenated two patterns into a dead `*.logreview-report.json` line.

Test count went from 1 happy-path test to **49**, including MCP integration tests that connect a real MCP `Client` over `InMemoryTransport` and assert the advertised schema matches what the handler actually reads (the exact class of bug the starter shipped with), subprocess tests of the CLI `main()` including symlink invocation, and the fsmonitor RCE control described above.

## What did you intentionally not do?

- **Confining MCP `repo_path`** to an allowlisted root. Right now an opted-in client can point the tool at any local path. This is the top item on my next-steps list; I prioritized fixing the broken contract and the code-execution gate first.
- **Replacing shell `exec` for validation commands.** For the CLI the human already has a shell, so `exec` is inside the trust boundary; for MCP the gate makes it operator-approved. Argv-array execution or sandboxing is future work, not a 90-minute item.
- **Parallel validation execution, configurable timeout/output-cap flags, configurable report filename** — straightforward but not what the assessment's risk profile rewards.
- **`npm audit` fixes** — the 5 reported vulns are in dev-only transitive deps (vitest chain) and one pinned override; noted, not churned.
- **An end-to-end test spawning the real stdio server binary** — the in-memory client covers the contract; process-level plumbing is lower value per minute.

## Interface decision

- **Decision:** Hybrid — one shared core (`reviewRepository`) with two deliberately thin adapters, MCP treated as the primary growth surface, CLI kept as the reliability/CI surface.
- **Primary user and execution environment:** An AI coding agent (Claude Code or similar) attached over stdio MCP on a developer's machine, reviewing local working copies; the same tool runs as a CLI for humans and CI on Node 20.12+.
- **Trust boundary and allowed capabilities:** The human who launches the process is trusted. The MCP client (the model) is not: it may name a repo and a base ref, but anything that is arbitrary code execution (`validation_commands`) requires the operator to opt in at startup via `INSPECTOR_ALLOW_VALIDATION=1`. Capabilities are granted by the human at process start, never by the model at call time. Git is always invoked with `execFileSync` argument arrays (never a shell) and with `core.fsmonitor` disabled, so a hostile repo cannot turn a read-only inspection into code execution through its own `.git/config`. The remaining gap is that `repo_path` is not yet confined to an allowlisted root — an opted-in operator's process can still be pointed at any readable path (top of the next-steps list).
- **Reliability, discoverability, latency/context, and output tradeoffs:** The CLI is the most debuggable and CI-friendly surface (deterministic exit codes, report on disk). MCP wins discoverability — the tool schema is self-describing to agents — but its output lands in a model's context window, so validation output is capped (64 KiB per command, truncation marked) and hostile output cannot break out of its markdown fence. Latency is dominated by git and validation commands, identical on both surfaces.
- **How supported interfaces remain consistent:** Both adapters call the same `reviewRepository` and emit the same report text; neither contains business logic. The MCP integration tests pin the advertised schema to the handler's actual reads, so the contract cannot silently drift again.
- **Evidence that would change this decision:** If usage telemetry showed invocations are overwhelmingly CI, I would go CLI-first and freeze the MCP surface. If the tool were hosted for multi-tenant use, I would go MCP-first with per-request auth, path confinement, and no shell execution at all. If agent clients started consuming the JSON report, I would add MCP `structuredContent` output.

## How did you use an AI coding agent?

I used Claude Code (Fable 5) end-to-end and directed it rather than typing the code myself. It cloned and read the full starter, produced the prioritized bug list, implemented each fix as its own slice + tests + commit, and ran the verification gates after every slice.

The part I lean on hardest is adversarial self-review. After the first round of fixes was green, I had it launch a multi-agent review workflow: five independent reviewers (correctness, tests, security, docs, requirements), and every finding they raised was then handed to a *separate* verifier agent prompted to refute it by reading the actual code — so a finding only survived if it was concretely demonstrable, not merely plausible. That pass produced 23 confirmed findings against my own work, including the `core.fsmonitor` RCE, the inverted heading escaping, and the symlink-bin no-op. I triaged them (reproducing the security and correctness ones myself — see the blocker note on the fsmonitor test), fixed the real ones, and left the low-value ones explicitly out of scope. The workflow is how I turn "the tests pass" into "I looked for the ways this is still wrong."

## Where did you check, correct, or reject an AI suggestion? (required)

1. **Wrong first diagnosis of the failing baseline.** The starter's `npm test` crashed before any change was made (`SyntaxError: ... does not provide an export named 'styleText'`), and the initial AI framing was that the starter's test tooling was broken. Checking the environment showed the real cause: my machine's default Node was 18.20.8 (asdf shim), below vitest 4's actual floor. Even after switching to Node 20.20.2 the tests still failed (`MODULE_NOT_FOUND` in rolldown) because `node_modules` had been installed under Node 18 — it took a clean reinstall under Node 20 to get a green baseline. The correction shipped as code: `engines` now says `>=20.12`, the real floor, instead of the starter's `>=20`.
2. **A confidently-wrong finding from the review pass, which I refuted.** One correctness reviewer claimed my validation timeout logic mislabels a `maxBuffer`-exceeded error as a timeout because Node sets `error.killed=true` in that case. Before changing anything I checked Node's `child_process` source and reproduced it: the `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` error is created *before* the internal kill and never gets `killed=true`, so the label is correct. The verifier agent had already independently marked it `real=false`; I confirmed by hand rather than trusting either agent. It shipped no code change — the right outcome.
3. **Rejected scope suggestion.** The AI proposed a per-command allowlist for MCP validation commands (operator lists exact permitted commands at startup). I rejected it for this timebox as over-engineering — a boolean opt-in draws the same trust boundary with far less surface — and kept the allowlist on the next-steps list. (I did accept the review's separate point that the boolean's env contract deserved a test.)

## Commands used to verify the result, with outcomes

All under Node 20.20.2 (the machine default Node 18 cannot run vitest 4 — see blocker):

- `npm ci` — clean install, no script warnings.
- `npm run typecheck` — clean at every commit.
- `npm test` — **49/49 passing** (unit tests for the git parser, validation runner, report escaping, CLI arg parsing, MCP env contract; integration tests for core, for the CLI `main()` as a subprocess including symlink invocation, and for the MCP tool through a real `Client` + `InMemoryTransport`; a fsmonitor-RCE control).
- `npm run build` then `node dist/cli.js review --repo "<temp repo>"` **and through a symlink to `dist/cli.js`** — compiled bin exists at the advertised path and produces a correct report on both (the symlink path was the installed-bin no-op bug).
- CLI smoke on a scratch repo whose path contains a space, with `--format json` and a deliberately failing `--validate` — report correct, JSON parseable, exit code 1.
- Mirrored the CI workflow (`npm ci && npm run typecheck && npm run build && npm test`) locally before the final push.

## A blocker you hit and how you approached it

The baseline test suite crashed on a pristine checkout. Instead of "fixing" the repo (the plausible-looking move — e.g. downgrading vitest), I checked the environment first: `node --version` showed 18.20.8 via an asdf shim, and vitest 4's rolldown needs `util.styleText` (Node 20.12+). Switching to Node 20.20.2 *still* failed, because `node_modules` had been built under Node 18; a clean `npm ci` under Node 20 produced a green baseline. Takeaway applied to the work: when a tool fails, establish whether the defect is in the code or the environment before changing the code — and if the environment is the defect, encode the discovery (`engines: >=20.12`) so the next person hits a clear error instead of a cryptic one.

A smaller second blocker: my first fsmonitor-RCE test failed, which momentarily looked like the hardening didn't work. Reproducing by hand showed the opposite — the *test* set `core.fsmonitor` before its own unhardened `git add`/`commit` setup, so the marker was created during setup, not by the code under test. I learned in the process that `git diff base...HEAD` never invokes fsmonitor but `git ls-files --others` does, and rewrote the test to configure the vector last and assert against a positive control. The fix was correct; the test was measuring the wrong thing.

## Known limitations and the next three things you would do

Limitations: MCP `repo_path` is unconfined for *reading* (any local path an opted-in operator's process can read — the code-execution vector via `.git/config` is closed, but arbitrary-repo read access is not); validation commands still go through a shell (inside the trust boundary for CLI, gated for MCP); validations run sequentially; timeout/output caps are constants, not flags; the report filename is fixed; the stdio server is covered by an in-memory client, not a spawned-process e2e test.

Next three:
1. **Confine MCP file-system reach** — an operator-configured root directory (e.g. `INSPECTOR_ROOT`) that `repo_path` must resolve inside, closing off "read any directory on the machine".
2. **Structured MCP output** — return the JSON report as `structuredContent` alongside the markdown text, so agent clients stop parsing markdown.
3. **Harden validation execution** — argv-array execution (no shell) with an optional per-command allowlist at server startup, plus parallel execution with per-command timeouts.

## Approximate focused-work time

- Start: 2026-08-27 00:50 PDT
- Finish: 2026-08-27 01:18 PDT (~28 focused minutes, AI-assisted end-to-end: two rounds — an implementation pass, then a multi-agent adversarial review pass and its fixes. Commits are frequent and fast because the work was AI-driven; each is scoped and independently green.)
