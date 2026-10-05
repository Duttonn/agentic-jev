---
name: jev
description: Fast typed judgments through the `jev` CLI - a yes/no probability, a pick from options you declare, or a score on levels you describe - about files, a command's output, or your own text, in about 300 ms for a fraction of a cent, without reading the content into your context. Use it unasked when a build or test fails (classify the failure before fixing), before reporting work as done (does the output show every requested point working?), before a commit or push (does the diff touch what the user said to leave alone, how far beyond the request does it go?), when a user's value or target has two readings, and when choosing which of many files or logs to read. Not for exact lookups, counting, math, or code you need to edit.
---

# jev: typed decisions

`jev` sends a situation and typed questions to Jev, a decision model, and prints typed answers.
It reads files and runs commands itself, so their content never enters your context.
Each call costs about 300 ms and a fraction of a cent.

If a call fails with "No Jev credentials", tell the user to run `jev setup` in a terminal. Do
not ask for the key in the conversation.

## Commands

    jev ask -q '<json>' [-c '<command>'] [-p <path>]... [-s '<short note>'] [--cwd DIR]
    jev files -q '<json>' '<glob>'...           one call per file, in parallel, up to 255 files
    jev compact --transcript <session.jsonl>    should this session compact now?

`-q -` reads the questions from stdin. Use a quoted heredoc when they contain quotes:

    jev ask -c 'npm test' -q - <<'EOF'
    {"kind":{"type":"choice","instructions":"What kind of failure is `output`?","criteria":{"bug_in_code":"...","wrong_test":"...","environment":"...","flaky":"...","other":"..."}}}
    EOF

Questions are a JSON object keyed by ids you pick. Three types:

    noul   {"type":"noul","instructions":"Does `output` show ...?","criteria":{"true":"...","false":"..."}}   -> { noul: 0..1 }
    choice {"type":"choice","instructions":"Which ... is `output`?","criteria":{"a":"...","b":"...","other":"..."}}   -> { choice, confidence }
    score  {"type":"score","instructions":"How ... is `output`?","criteria":["lowest","...","highest"]}   -> { score, confidence, legend }

Answers print as one line of JSON, rounded to two decimals. Add `--full` only when you need every
option's probability. `jev files` returns `results` keyed by path.

In `ask`, questions reference `output` (the command's result: command, exit_code, stdout, stderr),
`files["path"]` (each `-p`), or `text` (your `-s` note, or its own field names if it is a JSON
object). In `files`, they reference `content` and `path`. Ask everything you need in one call.
Always give a choice an `other` option. Describe situations, not degrees.

A choice over many options (more than about ten: skills, modules, services, error families) goes
in two calls: first a choice over a few categories, then a choice over the options of the
category that won. Each call stays short, which is where Jev is most accurate.

## When to reach for it

- **A build or test fails.** Before choosing a fix, pass the failing command in `-c` with a choice
  of bug_in_code / wrong_test / environment / flaky / other.
- **Before reporting work as done.** Put the user's request in `-s` and the check in `-c`, and ask
  one noul: "does `output` show every point the user asked for working?" Below 0.8, the report
  says what is not covered.
- **Before a commit or push.** Pass `-c 'git diff --staged'`, with the user's explicit "leave X
  alone" constraints in `-s`. Ask a noul ("does the diff touch what the user said to leave
  alone?") and score its scope against the request.
- **A value or target has two readings** (unit, base, which device, which branch). Put the
  user's words in `-s` and ask a choice over the readings. Below 0.7, state the reading and ask
  the user.
- **Choosing what to read.** Run `jev files` over the glob with a relevance noul, then read only
  the hits. Do the same for many logs or transcripts.

## Limits

- Not for exact lookups, counts, math or versions, or anything grep, an exit code or `df`
  answers. Not for facts only the user holds.
- An answer is a judgment, not evidence. A claim of "fixed" still needs the command that ran.
- `-c` runs the command in your shell as is, and jev itself does not gate it. Your own tool's
  permissions decide what may run.
- When an answer drove a decision, name it: "jev: bug_in_code 0.97 on `npm test`".
