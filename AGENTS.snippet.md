## Typed judgments go to jev

`jev` is on PATH (`jev --help` for the full schema). It answers typed questions (noul: yes/no
probability, choice: one of your options, score: a level you describe) about files, a command's
output, or a short note, in about 300 ms for a fraction of a cent, without the content
entering your context. Reach for it unasked:

- A build or test fails: `jev ask -c '<the command>'` with a choice of bug_in_code / wrong_test /
  environment / flaky / other, before choosing a fix.
- Before reporting done: the request in `-s`, the check in `-c`, a noul "does `output` show every
  point the user asked for working?". Below 0.8, say what is not covered.
- Before a commit or push: `-c 'git diff --staged'` with the user's "leave X alone" constraints in
  `-s`: did the diff touch them, and how far beyond the request does it go?
- A value or target with two readings: a choice over the readings. Below 0.7, state it and ask.
- Choosing what to read: `jev files` with a relevance noul, then read only the hits.

Not for lookups, counts, math, or facts only the user holds. An answer is a judgment, not
evidence.
