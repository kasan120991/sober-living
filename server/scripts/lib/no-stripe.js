/**
 * Makes a script run as though the server has NO Stripe key.
 *
 * MUST be imported before ../src/app.js and anything else that reaches
 * ../src/lib/stripe.js — ESM evaluates imports in order, and that module reads
 * `STRIPE_SECRET_KEY` once at load and freezes the answer into `stripeEnabled()`.
 * The as-owner.js precedent, for the same reason.
 *
 * Why a suite needs this at all: `verify-ledger.js` asserts that a keyless
 * server REFUSES to send an invoice (503) rather than returning 201 with a
 * local-only draft — the guard added on 2026-08-07 after a merge left
 * STRIPE_SECRET_KEY behind in a worktree and a send looked successful at the UI
 * while the invoice would never exist.
 *
 * That assertion used to depend on the machine happening to lack a key, which
 * inverted it: on any developer's box with a real `.env` the send SUCCEEDED,
 * and it did three things nobody wanted.
 *
 *   1. The assertion failed, reporting 201 where it wanted 503.
 *   2. The send genuinely BILLED the stay's pending lines, so the next step —
 *      which needs something unbilled to invoice — threw, and the suite DIED
 *      there. Roughly sixty later assertions never ran. CLAUDE.md recorded this
 *      as "the other 71 pass", which was too kind: it was one failure and a
 *      silent hole.
 *   3. It hit the real Stripe sandbox, creating a live invoice against a seeded
 *      resident every single time anyone ran the suite.
 *
 * Setting the variable to '' rather than `delete`-ing it is deliberate. dotenv
 * does not override a key already present in `process.env`, and an empty string
 * IS present — so a later `import 'dotenv/config'` further down the graph
 * cannot quietly put the real key back. `stripe.js` treats it as falsy and
 * exports a null client, which is exactly the state being asserted about.
 *
 * The production guard in stripe.js is untouched: it throws only when
 * NODE_ENV === 'production', and a verification suite is never run that way.
 */
import 'dotenv/config'

process.env.STRIPE_SECRET_KEY = ''
