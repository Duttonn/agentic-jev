# Billing sandbox

A small service the lab's agents work in: sessions and tokens under `src/auth`, storage under
`src/db`, HTTP handlers under `src/http`, and pure billing rules under `src/domain`. Tests run with
`npm test`. One test fails on purpose: proration in `src/domain/billing.ts` rounds the wrong way.
