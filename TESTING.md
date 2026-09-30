# Akira MVP Build & Test Guide

This tracks the MVP plan (see `PROJECT_CONTEXT.md` for the architecture) broken into
phases you can build, test, and sign off on one at a time. Each phase lists what
changed, why, and exact manual steps to verify it before moving to the next one.

**Status legend:** ✅ Done & verified · 🚧 In progress · ⬜ Not started

For a build-log view of what's been implemented phase by phase (technical
decisions, not test steps), see [`docs/phases/`](./docs/phases/README.md). For the
rules governing how this codebase gets built (financial-correctness invariants,
tooling discipline, verification bar), see
[`.agents/rules/build_workflow.md`](./.agents/rules/build_workflow.md).

---

## Automated tests

Beyond the manual steps below, there's now a real automated test suite —
run it any time with:

```bash
cd backend && npm test
```

As of the `fix/critical-bugs-batch-1` branch: **220 tests passing across 13 suites**.
Beyond Phase 0's original coverage (timezone-safe date math, decimal transformer,
extraction fallback fix), the financial-critical surface now has enforced coverage
thresholds — run `npm run test:cov` to see the report and confirm nothing regresses
below the thresholds in `backend/package.json`'s `jest.coverageThreshold`:

| Area | Statements | Notes |
|---|---|---|
| All 6 bank parsers + factory | 100% | Includes the empirically-verified HDFC regex behavior (a double space before the amount is what triggers the CREDIT/deposit branch — worth knowing if you're editing that regex). |
| `gemini.service.ts` | 98.6% | Full mock of the `@google/generative-ai` SDK — covers retry/backoff, the 429 and "limit: 0" special cases, and every validation branch in response parsing. |
| `extraction.service.ts` | 92.5% | Includes the Bug #2 (atomicity) and Bug #3 (CSV routing) regression tests. |
| `analytics.service.ts` | 100% | Every `financeChat` intent branch, `getSummary`, `getAiInsights` (cache hit/miss/empty), and all private helpers tested directly. |
| `transactions.service.ts` | 100% | Full CRUD, pagination clamping, and every filter branch — including the documented (not yet fixed) single-sided `from`/`to` date-filter gap, bug #16. |

Manual testing below is still worthwhile since it exercises the real HTTP/DB/Gemini
path end-to-end, which the unit tests intentionally mock out. Not yet covered:
`documents.service.ts`/`.controller.ts`, `accounts.service.ts`/`.controller.ts`,
`transactions.controller.ts` — see `docs/BUGS.md` #20.

---

## Before you start: quick reference

All manual API tests below use `curl`. Start the backend first:

```bash
cd backend
npm run start:dev   # http://localhost:3000
```

**Get a JWT token** (needed for every authenticated request below):

```bash
# Register (once) — or use login if you already have an account
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}' | jq

# Login (reuse this any time)
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq
```

Copy the `access_token` from the response and export it for convenience:

```bash
export TOKEN="paste-your-access_token-here"
```

Every other curl example below assumes `$TOKEN` is set and uses:
`-H "Authorization: Bearer $TOKEN"`

If you don't have `jq` installed, drop the `| jq` and read the raw JSON — it still works,
it's just less readable.

---

## Phase 0 — Foundation & correctness fixes ✅ Done & verified

No new user-facing feature. These are bug fixes and infrastructure that every later
phase depends on. I already verified build/tests/lint pass with no regressions —
the steps below are for *you* to sanity-check the behavior yourself.

### 0a. Database migrations exist now

**What changed:** Added `backend/src/data-source.ts`, `backend/src/migrations/`, and
`npm run migration:generate|run|revert` scripts. Previously there was no migration
tooling at all — schema changes only ever happened via TypeORM's `synchronize`.

**⚠️ Important:** Do **not** run `migration:run` against your real Supabase dev
database — it's already been created via `synchronize` and the baseline migration
would try to `CREATE TABLE` on tables that already exist, and fail. The baseline
migration is meant for a **fresh** database (e.g. a new prod database, or the local
Docker Postgres from scratch).

**How to test it (safely, using the local Docker Postgres, not Supabase):**

```bash
# 1. Spin up a completely fresh local database (drops any old local data)
docker exec akira_db psql -U postgres -c "DROP DATABASE IF EXISTS akira_test;"
docker exec akira_db psql -U postgres -c "CREATE DATABASE akira_test;"
docker exec akira_db psql -U postgres -d akira_test -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 2. Run the migration against it
cd backend
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/akira_test" npm run migration:run
```

**Expected result:** You should see `Migration Baseline... has been executed successfully.`
and no errors. Then confirm the tables exist:

```bash
docker exec akira_db psql -U postgres -d akira_test -c "\dt"
```

You should see `users`, `accounts`, `documents`, `transactions`, `document_chunks`,
`migrations`. Clean up afterward if you like:

```bash
docker exec akira_db psql -U postgres -c "DROP DATABASE akira_test;"
```

### 0b. Transaction amounts are now real numbers

**What changed:** `Transaction.amount` previously came back from the database as a
string (e.g. `"1500.00"`) even though TypeScript claimed it was a `number`. Now it's
a genuine number.

**How to test it:**

```bash
curl -s http://localhost:3000/transactions -H "Authorization: Bearer $TOKEN" | jq '.data[0].amount'
```

**Expected result:** The value prints **without quotes**, e.g. `1500` — if it printed
`"1500.00"` (with quotes), that would mean it's still a string. If you have no
transactions yet, create one first (see Accounts/Transactions test below) or wait
until you're testing Phase 1/2 with a real statement upload.

### 0c. Date-range filters are timezone-safe

**What changed:** `dateRange` filters (`1m`, `3m`, `6m`, `1y`) and the finance-chat
date phrases ("this month", "last month", etc.) used to be computed using the
server's local clock, which could shift boundaries by hours depending on server
timezone vs. your timezone (IST). Now they're computed independent of server
timezone.

**How to test it:** This is a robustness fix more than something dramatically
visible, but you can sanity-check the boundaries are calendar-correct:

```bash
# Should return transactions/aggregates going back exactly 1 calendar month from today
curl -s "http://localhost:3000/analytics/summary?dateRange=1m" -H "Authorization: Bearer $TOKEN" | jq '.metrics'
```

**Expected result:** No errors, and the `metrics.transactionCount` should match what
you'd expect for the last calendar month of your test data. The important
regression check is really "nothing broke" — compare `dateRange=1m/3m/6m/1y/all`
against what the Dashboard page showed before this change; the numbers should be
the same or more accurate, never wildly different.

### 0d. Analytics query refactor (no visible change expected)

**What changed:** Internal refactor only — three separate places that each
re-implemented "filter by user/account/date" now share one helper. This should be
**invisible** — if anything looks different in `/analytics/summary` results, that's
a regression, not intended behavior.

**How to test it:** Open the Dashboard page in the browser and confirm the metrics
cards, cashflow chart, and top categories chart all still render with sensible
numbers, same as before this change.

### 0e. Deleting an account no longer leaves stale AI insights

**What changed:** `AccountsService.remove()` now invalidates the cached AI insights
for that user.

**How to test it:**

```bash
# 1. Get AI insights (this populates the cache)
curl -s "http://localhost:3000/analytics/ai-insights" -H "Authorization: Bearer $TOKEN" | jq '.summary'

# 2. Delete one of your accounts (replace :id)
curl -s -X DELETE http://localhost:3000/accounts/1 -H "Authorization: Bearer $TOKEN"

# 3. Immediately fetch AI insights again
curl -s "http://localhost:3000/analytics/ai-insights" -H "Authorization: Bearer $TOKEN" | jq '.summary'
```

**Expected result:** The second `ai-insights` call should reflect the account
deletion (different/regenerated summary based on remaining transactions), not an
identical cached response from before the deletion. This is hard to see with a
single account/no transactions — it's most meaningful if you have transactions on
multiple accounts to compare before/after.

### 0f. Unsupported/stub bank statements no longer silently produce zero transactions

**What changed:** If your statement's bank name matches one of the 5 stub parsers
(ICICI, HSBC, UCO, PNB, Axis) or an unrecognized bank, the extraction pipeline now
falls back to Gemini extraction instead of silently saving nothing.

**How to test it:**

1. Go to the **Documents** page in the app, upload a bank statement PDF from one of
   the stub banks (or any bank other than HDFC), linked to an account.
2. Watch the backend terminal logs while it processes. You should see a log line
   like:
   `Deterministic parser produced no transactions for document X, falling back to Gemini text extraction`
3. Once the document status becomes `COMPLETED`, check the Transactions page (or
   `GET /transactions?documentId=X` — note: this filter isn't wired up in the API
   yet, that's part of Phase 1 — for now just check the Transactions page filtered
   by that account).

**Expected result:** Transactions actually appear, extracted via Gemini, instead of
zero transactions with no explanation.

---

## Phase 1 — Reconciliation + mandatory review workflow ⬜ Not started

**What it will add:** After a statement is extracted, the app checks the extracted
transactions' total against the statement's own opening/closing balance. Regardless
of whether it matches, transactions land in a "needs review" state and won't count
toward your Dashboard/Analytics/Budgets until you explicitly confirm them (one-click
if the balance matches cleanly, per-row review if it doesn't).

**How you'll test it once built:**
- Upload a statement → confirm it does *not* immediately show up in Dashboard totals.
- Open the new Review screen from the Documents page → see the reconciliation
  banner (✅ matched / ⚠️ mismatch) and the extracted transactions.
- Bulk-confirm (if matched) or edit-then-confirm individually (if mismatched) → then
  confirm Dashboard/Transactions totals update to include them.
- Edit an amount/category before confirming → confirm the corrected value is what
  gets saved, not the original extraction.

*(I'll fill in exact curl/UI steps here once this phase is implemented.)*

---

## Phase 2 — Harden the 6 bank parsers ⬜ Deferred (blocked on you)

**Blocked on:** real/representative statement text samples for ICICI, HSBC, UCO,
PNB, Axis (HDFC's existing regex also needs a real sample to verify). When you have
one or more, share the extracted text (redact account numbers/personal info first)
and I'll implement + test the parser for that bank.

**How you'll test it once built:** Upload a real statement for that bank → confirm
it goes through the deterministic parser (check logs — no "falling back to Gemini"
message) → confirm every transaction and the balance are extracted correctly by
comparing against the actual statement.

---

## Phase 3 — RAG (grounded chat + semantic search) ⬜ Not started

**What it will add:** The finance chat widget on the Dashboard will be able to
answer questions grounded in your actual statement text and transaction history
(not just pre-programmed SQL queries), with source citations.

**How you'll test it once built:**
- Ask a question the current chat can't answer (e.g. "what does my March statement
  say about late payment fees?") → confirm it retrieves and cites the right
  document/snippet instead of saying "I don't understand."
- Ask a normal numeric question (e.g. "how much did I spend this month?") → confirm
  it still answers via the deterministic path, unaffected by this change.

*(Exact steps to follow once implemented.)*

---

## Phase 4 — Budgets & spending limits ⬜ Not started

**How you'll test it once built:**
- Create a monthly budget for a category (e.g. ₹5,000 for "Food").
- Add/confirm reviewed transactions in that category.
- Check `GET /budgets/status` (or the Budgets page) shows correct spend-vs-limit and
  an over-budget indicator once you cross the limit.
- Confirm unreviewed transactions in that category are *not* counted.

---

## Phase 5 — Recurring bills / subscriptions ⬜ Not started

**How you'll test it once built:**
- Have ≥3 transactions from the same vendor at a consistent monthly interval.
- Trigger a scan on the Recurring Bills page → confirm it's detected as a candidate
  with the correct amount (matching actual transactions, not a guessed number) and
  a sensible next-due-date.
- Confirm dismissing a candidate stops it from reappearing on the next scan.

---

## Phase 6 — Net worth / multi-account trend ⬜ Not started

**How you'll test it once built:**
- Set a starting balance on an account.
- Add reviewed transactions → confirm the account's shown balance = starting
  balance + net of reviewed transactions (do the arithmetic yourself and compare).
- Check the Net Worth page's trend line across multiple accounts, including a
  credit card account (should subtract from total, not add).

---

## Updating this doc

I'll update this file (adding exact steps under each phase and flipping its status)
as each phase is implemented, so it stays a running record of what's built and how
to check it.
