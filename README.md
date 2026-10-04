# agentic-jev

Jev inside any agentic coding environment. [Jev](https://typesafe.ai) answers typed questions in about
300 ms for a fraction of a cent: a yes/no probability, a pick from options you declare, or a score on
levels you describe. This package puts that in reach of a coding agent, so it can settle bounded
judgment calls without reasoning them out at length or reading files into its context:

- **`jev` CLI.** Works in any agent that has a shell. `jev ask` judges one situation: your note, files it
  reads, a command it runs. `jev files` asks the same questions of many files in parallel. `jev compact`
  says whether a session should compact now and where to cut.
- **An agent skill** (`skills/jev/SKILL.md`, the Agent Skills format). It tells the agent when to reach
  for jev without being asked: a failing build, before reporting done, before a commit, an ambiguous
  value, choosing what to read.
- **A Claude Code plugin.** It bundles the skill, puts `jev` on the Bash PATH, and adds a Stop hook that
  tells you when compacting is worth it, with a ready `/compact` line.
- **`AGENTS.snippet.md`.** The same guidance, for agents that read an instructions file instead of skills.

Built on [disler/ten-levels-of-jev](https://github.com/disler/ten-levels-of-jev) (MIT). Its Jev client
and its levels 7 to 10 are vendored unchanged under `src/core` and `src/levels`, with their tests.

## Install

Needs Node 22.18 or later, and a Jev key: TypeSafe (`apikey_...`) or OpenRouter (`sk-or-...`).

```sh
git clone git@github.com:Duttonn/agentic-jev.git && cd agentic-jev
./install.sh
```

`install.sh` does three things:
- links `jev` into `~/.local/bin`;
- asks for the key and stores it in `~/.config/jev/env`, mode 600;
- links the skill into `~/.agents/skills/jev`, where Codex and other agents look for user skills.

You can run `jev setup` again at any time to replace the key. A key already exported as
`TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` takes precedence over the file.

### Claude Code

```sh
claude plugin marketplace add Duttonn/agentic-jev
claude plugin install jev@agentic-jev
```

This installs the skill, `jev` on the Bash tool's PATH, and the compaction hook. Run `./install.sh` or
`bin/jev setup` once from a terminal for the key.

### Codex

`install.sh` already links the skill into `~/.agents/skills`. Codex needs network access for `jev`, so
approve the escalation if its sandbox blocks the call.

### Any other agent

Put `jev` on PATH (`install.sh`), then paste `AGENTS.snippet.md` into the file the agent reads:
`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, or the equivalent.

## Use

```sh
# classify a failure without reading the test output
jev ask -c 'npm test' -q '{"kind":{"type":"choice","instructions":"What kind of failure is `output`?","criteria":{"bug_in_code":"The code under test is wrong","wrong_test":"The test expects the wrong thing","environment":"Missing deps, config, network","other":"Anything else"}}}'

# which files matter, before opening any
jev files 'src/**/*.ts' -q '{"relevant":{"type":"noul","instructions":"Does `content` compute invoice totals?"}}'

# should this session compact now?
jev compact --transcript ~/.claude/projects/<project>/<session>.jsonl
```

`jev --help` prints the full question schema. Answers come back as JSON with `state_summary` (what was
sent) and `cost`. Questions with quotes go through stdin: `-q -` with a quoted heredoc.

`-c` runs the command in your shell exactly as given, and jev puts no gate in front of it. What may run
is up to the agent's own permission system, which already sees the full `jev ask -c '...'` command line.

## Compaction

`jev compact` reads a Claude Code transcript. It takes the context size from the last request
(input + cache read + cache write tokens), so below the first line it asks nothing and costs nothing.
Above that line, Jev answers four questions:
- did the request switch tasks;
- did the last turn finish a unit of work;
- how much history does the next step need;
- is a multi-step edit half done.

Code turns those answers into a tier: notice, recommend or request. When a tier is earned, a second call
picks the turn where the live work starts. The verdict then carries `/compact <instructions>` that keep
that turn onward in detail.

As a Claude Code Stop hook (the plugin installs it), it prints a message only when compacting is worth
it. No hook can start `/compact`, so you run the line it gives you.

The lines are context tokens. With an auto-compact window W, from `JEV_COMPACT_WINDOW` or Claude
Code's `autoCompactWindow` setting, they sit at W/6, W/3 and 7W/12. Without a window they are 100k,
200k and 350k. `JEV_COMPACT_LINES=notice,recommend,request` overrides both.

## Files and settings

| What | Where | Override |
| --- | --- | --- |
| API key | `~/.config/jev/env` | `JEV_CONFIG`, or export the key |
| Ledger: one line per call, question ids, answers and usage, never the state | `~/.local/state/jev/ledger.jsonl` | `JEV_STATE_DIR` |
| Compaction hook log | `~/.local/state/jev/compact.log` | `JEV_STATE_DIR` |
| Offline mock, no key needed | | `JEV_BACKEND=mock` |

## Test

```sh
npm test                                  # 167 offline tests on the deterministic mock
JEV_LIVE=1 npm run test:live              # the CLI tests against real Jev, a fraction of a cent
```

## License

MIT. See `LICENSE`; the vendored upstream code keeps its copyright line.
