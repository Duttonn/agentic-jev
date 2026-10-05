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
npx -y github:Duttonn/agentic-jev install
```

Or from a clone: `bin/jev install`. Either way, the install does four things:
- copies jev to `~/.local/share/jev`;
- links `jev` into `~/.local/bin`;
- links the skill into `~/.agents/skills/jev`, where Codex and other agents look for user skills;
- asks for the key if none is set, and stores it in `~/.config/jev/env`, mode 600.

Run the same command again to update. `jev setup` replaces the key at any time. A key already exported
as `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` takes precedence over the file. `JEV_HOME`, `JEV_BIN_DIR`
and `JEV_SKILLS_DIR` move the three install locations.

### Claude Code

```sh
claude plugin marketplace add Duttonn/agentic-jev
claude plugin install jev@agentic-jev
```

This installs the skill, `jev` on the Bash tool's PATH, the compaction hook, the research hook, and the
search-results filter. For the key, run the npx
install above once from a terminal.

### Codex

The install already links the skill into `~/.agents/skills`. Codex needs network access for `jev`, so
approve the escalation if its sandbox blocks the call.

### Any other agent

After the install, paste `~/.local/share/jev/AGENTS.snippet.md` into the file the agent reads:
`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, or the equivalent.

## Use

```sh
# classify a failure without reading the test output
jev ask -c 'npm test' -q '{"kind":{"type":"choice","instructions":"What kind of failure is `output`?","criteria":{"bug_in_code":"The code under test is wrong","wrong_test":"The test expects the wrong thing","environment":"Missing deps, config, network","other":"Anything else"}}}'

# which files matter, before opening any; --top 5 keeps the five best, best first
jev files 'src/**/*.ts' --top 5 -q '{"relevant":{"type":"noul","instructions":"Does `content` compute invoice totals?"}}'

# does this task need a lookup before acting? prints a hint naming what to look up first, or null
jev research -s 'Upgrade the project to the latest Expo SDK and fix whatever breaks'

# wait for a deploy without polling: one line per change, exits once it reads yes
jev watch -c 'kubectl rollout status deploy/api --timeout=1s' --every 30 --until \
  -q '{"done":{"type":"noul","instructions":"Does `output` show the rollout finished, successfully or not?"}}'

# should this session compact now?
jev compact --transcript ~/.claude/projects/<project>/<session>.jsonl
```

`jev --help` prints the full question schema. Answers come back as one line of JSON, rounded to two
decimals, with `state_summary` (what was sent) and `cost`. `jev files` keys its `results` by path.
`--full` adds the type tags, every option's probability, usage and model: about five times the tokens. Questions with quotes go through stdin: `-q -` with a quoted heredoc.

`-c` runs the command in your shell exactly as given, and jev puts no gate in front of it. What may run
is up to the agent's own permission system, which already sees the full `jev ask -c '...'` command line.

## Compaction

`jev compact` reads a Claude Code transcript. It takes the context size from the last request
(input + cache read + cache write tokens), so below the first line it asks nothing and costs nothing.
A short follow-up of at most 60 characters ("ok", "continue", "do O2") is skipped the same way: it
continues the last turn, so compacting there would cut what it points to. Otherwise, Jev answers four
questions:
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

## Research

`jev research` asks Jev whether a request rests on facts from outside the user's files: a library's
docs or API, current versions, prices, a third-party error, a link the user gave. At 0.7 or above it
returns a hint naming what to look up first. jev names no tool: the agent uses the search, fetch or
docs tools it has. `JEV_RESEARCH_TOOLS` (in `~/.config/jev/env`, for example
`JEV_RESEARCH_TOOLS=web_search, fetch`) adds your preferred ones to the hint.

As a Claude Code UserPromptSubmit hook (the plugin installs it), the hint goes into the model's
context only on a yes. Slash commands and short follow-ups are skipped with no call. Any harness with
a prompt hook can do the same: run `jev research -s "$PROMPT"` and pass `hint` to the model when it
is not null. It adds one Jev call per prompt, about 300 ms.

## Search results

`jev filter` cuts a list of search results down to the ones that answer the query. It reads Exa's
format: blocks that open with `Title: `, joined by a `---` line. Jev scores every result against the
query in parallel. The best `--top K` (default 5) stay whole, except those under 0.05, which are off
topic. The others shrink to a title, a URL and their score, so a fetch can still bring one back. Text
in any other shape passes through unchanged.

The plugin runs it as a PostToolUse hook on Exa's web search tools and replaces what the model sees.
On a sample of 8 results for a query about Laya, it kept the 4 about the model and dropped a pizza
guide, a guitar lesson, market news and a "Laya Beach Resort", each at 0.01. The built-in WebSearch
is left alone: it returns about 3 KB of titles, URLs and a summary, so there is nothing to save.

```sh
jev filter -s 'Laya open source decision model, how to run it locally' --top 4 < results.txt
```

## Files and settings

| What | Where | Override |
| --- | --- | --- |
| API key | `~/.config/jev/env` | `JEV_CONFIG`, or export the key |
| Ledger: one line per call, question ids, answers and usage, never the state | `~/.local/state/jev/ledger.jsonl` | `JEV_STATE_DIR` |
| Compaction hook log | `~/.local/state/jev/compact.log` | `JEV_STATE_DIR` |
| Search filter log: what each search kept, with the scores | `~/.local/state/jev/filter.log` | `JEV_STATE_DIR` |
| Research hook errors | `~/.local/state/jev/research.log` | `JEV_STATE_DIR` |
| Preferred search tools named in the research hint | | `JEV_RESEARCH_TOOLS` |
| Offline mock, no key needed | | `JEV_BACKEND=mock` |

## Test

```sh
npm test                                  # the offline tests, on the deterministic mock
JEV_LIVE=1 npm run test:live              # the CLI tests against real Jev, a fraction of a cent
```

## License

MIT. See `LICENSE`; the vendored upstream code keeps its copyright line.
