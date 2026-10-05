# agentic-jev

Jev inside any agentic coding environment. [Jev](https://typesafe.ai) answers typed questions in about
300 ms for a fraction of a cent: a yes/no probability, a pick from options you declare, or a score on
levels you describe. [Laya](https://github.com/NandhaKishorM/laya), an open-weights model with the same
API, can stand in for it on your machine or on a team server. This package puts that in reach of a coding agent, so it can settle bounded
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
and its levels 7 to 10 are vendored under `src/core` and `src/levels`, with their tests. The one change is a
`laya` provider in `src/core/client.ts`.

## Install

Needs Node 22.18 or later, and a decision model: a Jev key (TypeSafe `apikey_...` or OpenRouter `sk-or-...`),
or Laya, which setup installs on this machine (uv or Python 3.10+) or finds on another one.

```sh
npx -y github:Duttonn/agentic-jev install
```

Or from a clone: `bin/jev install`. Either way, the install does four things:
- copies jev to `~/.local/share/jev`;
- links `jev` into `~/.local/bin`;
- links the skill into `~/.agents/skills/jev`, where Codex and other agents look for user skills;
- runs `jev setup` if nothing is configured: a Jev key, Laya on this machine, or Laya on another machine,
  stored in `~/.config/jev/env`, mode 600.

Run the same command again to update. `jev setup` changes the choice at any time. A key already exported
as `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` takes precedence over the file. `JEV_HOME`, `JEV_BIN_DIR`
and `JEV_SKILLS_DIR` move the three install locations.

### Claude Code

```sh
claude plugin marketplace add Duttonn/agentic-jev
claude plugin install jev@agentic-jev
```

This installs the skill, `jev` on the Bash tool's PATH, the compaction hook, the research hook, the
search-results filter, and a SessionStart hook that warms a local Laya (it does nothing with any other
backend). For the key, run the npx
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

## Laya

`jev setup` offers three backends:

1. **Jev**, TypeSafe's hosted API, with a key.
2. **Laya on this machine.** Setup installs `laya[serve]` in `~/.local/share/jev-laya` (about 0.7 GB of
   Python packages; the 1.4 GB of model files come on first start) and checks one call. After that, jev
   starts `laya-serve` on `127.0.0.1:8765` at the first call of an agent session and stops it a minute
   after the last session ends.
3. **Laya on another machine.** The URL of a `laya-serve`, and its key if it was started with
   `LAYA_API_KEY`.

The local server follows agent sessions. Each call registers the agent it runs under: the first parent
process that is not a shell (`claude`, `codex`, an editor). A detached supervisor keeps `laya-serve` up
while one of them is alive, and stops it 60 seconds after the last one exits. A crashed session ends the
same way as a closed one. `jev laya status` shows the server and the agents keeping it up; `jev laya stop`
stops it now. The first call of a session waits for a cold start, about 6 s on an M4 Pro. After that a
question takes about 45 ms, against about 300 ms for Jev. The server uses 0.9 GB of RAM with its English
and multilingual checkpoints loaded.

jev sends `max_len: 8192` with every call. Laya otherwise reads 512 tokens and drops the rest of the
state: on a 2.8k-token diff, it dropped 83% and answered 0.38 where the full read answered 0.73.

Quality is the catch. On the 14 labelled prompts of the research check, Jev answers 14/14 and Laya 7/14:
it says no to every one, with no separation between the two groups. On the community
[Decision Index](https://multimodalart-jev-decision-index.static.hf.space/index.html) (54 benchmarks,
2026-09-28), balanced skill is 57.9 for Jev and 6.0 for Laya. Laya is fast and private, but for jev's
questions it needs fine-tuning first. Any server that answers the same `POST /v1/systemone` (llama.cpp's
`llama-server` now does, for several open decision models) should work through `LAYA_URL`; only
`laya-serve` is tested.

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
| Research hint line, default 0.7 (Jev); `npm run bench` gives another backend's | | `JEV_RESEARCH_LINE` |
| Backend: `typesafe`, `openrouter`, `laya` or `mock` (offline, no key) | `~/.config/jev/env` | `JEV_BACKEND` |
| Laya server URL, default `http://127.0.0.1:8765` | `~/.config/jev/env` | `LAYA_URL` |
| Laya server key, when it has one | `~/.config/jev/env` | `LAYA_API_KEY` |
| jev starts and stops Laya on this machine | `~/.config/jev/env` | `JEV_LAYA_LOCAL=1` |
| Local Laya install | `~/.local/share/jev-laya` | `JEV_LAYA_HOME` |
| Local Laya log | `~/.local/state/jev/laya/server.log` | `JEV_STATE_DIR` |

## Bench

`npm run bench` asks jev's fixed questions about 172 cases, none of them from any one user. The cases
cover three families:
- the research check: 48 written requests in English, French and German, half needing a lookup, plus
  64 real first prompts from [DevGPT](https://doi.org/10.5281/zenodo.10086809) (developers' shared
  ChatGPT conversations, CC BY 4.0). Those were sampled across issues, PRs, commits, files, discussions
  and Hacker News, and labelled by hand; 10 of the 64 need a lookup;
- the search filter: 5 queries with 8 results each, with look-alike distractors;
- failure triage: 20 command outputs.

Each family is split in two: `dev` picks a backend's line, and `test` reports how that line holds on
cases it never saw. The bench runs on whatever `JEV_BACKEND` selects, so the same command compares Jev,
Laya, or any `/v1/systemone` server behind `LAYA_URL`. Results go to `bench/results/<name>.json`.

| 2026-10-05 | Jev | decider-4b | Laya |
| --- | --- | --- | --- |
| Research: ranking (AUC) | 1.00 | 1.00 | 0.78 |
| Research: test accuracy at 0.7 | 0.92 | 0.75 | 0.50 |
| Research: line from dev, test accuracy | 0.385, 0.96 | 0.29, 0.96 | 0.415, 0.63 |
| Research: what to look up | 0.96 | 0.83 | 0.38 |
| Real requests (DevGPT): AUC | 0.93 | not run | 0.70 |
| Real requests: test accuracy at 0.7, at 0.5 | 0.91, 0.97 | not run | 0.91, 0.78 |
| Filter: AUC, test accuracy at 0.5 | 0.99, 0.94 | 1.00, 1.00 | 0.95, 0.56 |
| Triage | 0.95 | 0.95 | 0.40 |

decider-4b ranks as well as Jev but is less sure of itself: it needs its own line, which
`JEV_RESEARCH_LINE=0.29` sets. Laya does not separate the research cases at any line.

Even for Jev, 0.7 is strict. On both test sets, the written one and the real one, 0.5 does better: 0.96
and 0.97 against 0.92 and 0.91. On the real requests, a constant "no" already scores 0.875, so 0.7
barely beats it.

The real-use check below shows the limit of that line. On 80 prompts from one user's transcripts, Jev
said 16 needed a lookup. decider-4b still ranked them well (AUC 0.88 against Jev), but at 0.29 it agreed
with Jev on only 70%, below the 80% a constant "no" would get. The dev cases are shorter and cleaner
than real requests, so the next cases to add are long, multi-part ones.

`npm run bench -- --agree DIR` validates on real use instead. It takes typed requests from Claude Code
transcripts under DIR, masks anything that looks like a key, and labels them with Jev, the teacher. It
then reports how well the backend under test agrees. Nothing is tuned on these prompts, and none is
printed.

```sh
JEV_BACKEND=typesafe npm run bench -- --name jev
JEV_BACKEND=laya LAYA_URL=http://gpu-box:8000 BENCH_CONCURRENCY=1 npm run bench -- --name decider-4b
JEV_BACKEND=laya LAYA_URL=http://gpu-box:8000 JEV_RESEARCH_LINE=0.29 npm run bench -- --agree ~/.claude/projects --n 80
```

## Test

```sh
npm test                                  # the offline tests, on the deterministic mock
JEV_LIVE=1 npm run test:live              # the CLI tests against real Jev, a fraction of a cent
```

## License

MIT. See `LICENSE`; the vendored upstream code keeps its copyright line.
