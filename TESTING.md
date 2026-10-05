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

## CI

`.github/workflows/ci.yml` runs automatically on every PR and on pushes to `main`:

- **Backend**: install → build → lint (changed files only — see note below) →
  `npm run test:cov` (unit tests + the coverage thresholds above) → `npm run
  test:e2e` against a real `pgvector/pgvector:pg16` service container.
- **Frontend**: install → build → lint (changed files only).

**Why "changed files only" for lint:** both packages have real pre-existing lint
debt (750+ issues backend, ~11 frontend) that a full-repo gate would fail on
immediately. The CI lint step diffs the PR against its base branch and only lints
files actually touched — new/changed code must be clean, but merging isn't
blocked by debt elsewhere. See `docs/BUGS.md` for the backlog of what a full
cleanup would need to address.

---

## Automated tests

Beyond the manual steps below, there's now a real automated test suite —
run it any time with:

```bash
cd backend && npm test
```

As of the `fix/critical-bugs-batch-1` branch: **258 tests passing across 17 suites**.
Beyond Phase 0's original coverage (timezone-safe date math, decimal transformer,
extraction fallback fix), the financial-critical surface now has enforced coverage
thresholds — run `npm run test:cov` to see the report and confirm nothing regresses
below the thresholds in `backend/package.json`'s `jest.coverageThreshold`. It also
now includes real end-to-end proofs (via `supertest`, real HTTP requests, not mocked
behavior) for all four fixed High-severity bugs (`docs/BUGS.md` #4/#5/#6/#8):
rate limiting on `/auth/login` and `/auth/register`, AI-insights figures verified
against real transactions before reaching the user, the `RolesGuard`/`@Roles()`
mechanism, and query-param validation on `GET /transactions`.

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

## Phase 1 — Reconciliation + mandatory review workflow ✅ Done & verified

**What changed:** Extracted transactions always land `reviewed: false` and are
excluded from every analytics aggregate (`/analytics/summary`, AI insights, and
`/analytics/chat`'s deterministic path — both of `AnalyticsService`'s base query
builders now gate on `tx.reviewed = true`) until explicitly confirmed. Manually
created transactions (`POST /transactions`) are `reviewed: true` immediately — they
carry none of the extraction uncertainty the gate exists for.

After each document finishes extracting, `GeminiService.extractDocumentBalances()`
looks for an explicitly-printed opening/closing balance in the statement text (never
inferred — `null` if absent) and `ExtractionService` compares it against the sum of
that document's own extracted transactions, within a ₹5 tolerance:
- **MATCHED** → the Review page shows a single "Confirm all N" bulk-confirm button
  (`PATCH /documents/:id/confirm-review`, one DB transaction).
- **MISMATCH** or **NOT_APPLICABLE** (no balance found, e.g. scanned/image statements
  with no extractable text) → per-row review is required; no bulk shortcut.

**Deviation from the original plan worth knowing:** the plan called for wiring
HDFC's parser-captured trailing balance group into `closing_balance` specifically.
Instead, balance extraction is done once, uniformly, via Gemini for every
text-based document (regardless of which deterministic parser matched) — this
covers all banks instead of just HDFC, with no `BankParser` interface change. Vision
(scanned/image) documents have no raw text to extract a balance from, so they
reliably land on `NOT_APPLICABLE` → per-row review, which is the safe fallback
already built for "no balance found."

**How to test it:**

1. Upload a statement whose text contains something Gemini will recognize as a
   balance line (e.g. "Opening Balance: 1000.00" ... "Closing Balance: 650.00") with
   transactions that actually sum to that delta. A plain `.csv` works, since CSVs go
   through the same text path as a text PDF:
   ```bash
   curl -s -X POST http://localhost:3000/documents \
     -H "Authorization: Bearer $TOKEN" \
     -F "file=@statement.csv;type=text/csv" \
     -F "title=Test Statement" \
     -F "accountId=<your account id>"
   ```
2. Confirm it does *not* show up in `/analytics/summary` yet:
   ```bash
   curl -s "http://localhost:3000/analytics/summary" -H "Authorization: Bearer $TOKEN" | jq '.metrics'
   ```
   `transactionCount`/`totalOutflow` should not include the new transactions.
3. Check the document's reconciliation fields:
   ```bash
   curl -s "http://localhost:3000/documents/<id>" -H "Authorization: Bearer $TOKEN" \
     | jq '{reconciliation_status, opening_balance, closing_balance, reconciled_delta}'
   ```
4. Open **Documents** in the app → click **Review** on the completed document → confirm
   the reconciliation banner matches step 3, and (if MATCHED) click **Confirm all N**,
   or (if MISMATCH/NOT_APPLICABLE) **Edit** a row, change a value, **Save & Confirm**,
   then **Confirm** the rest individually.
5. Re-check `/analytics/summary` and the **Transactions** page — the confirmed
   transactions should now be included, and rows no longer show the "Unreviewed"
   badge.

**Known local-dev quirk, not a regression:** this repo's local Postgres (`akira_db`
docker-compose) has never had the `migrations` tracking table populated — its schema
was built entirely by TypeORM's dev-only `synchronize`, same as before this phase
(the Phase 0 baseline migration was never run against it either). The new
`ReconciliationAndReview` migration was verified independently against a scratch
database (clean apply + clean revert) — see
`backend/src/migrations/1791136200000-ReconciliationAndReview.ts`.

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

## Phase 3 — RAG (grounded chat + semantic search) ✅ Done & verified

**What changed:** After a text-based document (PDF-with-text or CSV) finishes
extraction, its raw text is persisted (`Document.raw_text`), split into ~800-char
overlapping chunks, embedded with Gemini, and stored in `document_chunks`
(`vector(768)`). The finance chat endpoint (`POST /analytics/chat`) now falls back
to this grounded-retrieval path whenever `parseFinanceChatIntent()` returns
`unknown` — in particular, fine-print/terms questions ("what's the late payment
fee?") rather than the fixed canned message it used to return. The retrieval query
is scoped to the logged-in user's own documents (join on `documents.user_id`, never
a separate filter to forget). Every numeric figure in the generated answer is
checked against the retrieved excerpts; an unverifiable one gets a disclaimer
appended rather than being silently trusted. Deterministic numeric intents
(`sum_debits`, `top_category`, etc.) are completely unaffected — this is a separate
code path (`RagService`), not a change to `executeFinanceIntent`.

**How to test it:**

1. Upload a statement whose text includes something that reads like fine print, not
   a transaction (a CSV works — it goes through the same text path as a text PDF):
   ```bash
   curl -s -X POST http://localhost:3000/documents \
     -H "Authorization: Bearer $TOKEN" \
     -F "file=@statement.csv;type=text/csv" \
     -F "title=Test Statement" \
     -F "accountId=<your account id>"
   ```
   e.g. a line like `A late payment fee of 2% of the outstanding balance will be
   charged if payment is not received within 15 days, minimum fee Rs 500.`
2. Once `COMPLETED`, confirm chunks were embedded:
   ```bash
   docker exec akira_db psql -U postgres -d akira_local -c \
     "SELECT id, document_id, vector_dims(embedding) FROM document_chunks WHERE document_id = <id>;"
   ```
   Expect one or more rows with `vector_dims` = 768.
3. Ask the fine-print question through chat:
   ```bash
   curl -s -X POST http://localhost:3000/analytics/chat -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"message":"What does my statement say about late payment fees?"}' | jq
   ```
   Expect `answer` to state the real fee (2%, Rs 500, 15 days) with a `[1]`-style
   citation, and `sources` to list the right `documentId`/`documentTitle`.
4. Ask a normal numeric question (e.g. "how much did I spend this month?") →
   confirm the response has **no** `sources` field and still comes from the
   deterministic path.
5. In the **Dashboard** chat widget, ask the same fine-print question → confirm the
   answer renders with a small citation tag (the document title) underneath it.

**Known limitation, not a bug:** vision-path documents (scanned PDFs/images) never
get indexed — there's no extracted text to chunk on that path today. A fine-print
question about a scanned-only statement correctly returns "couldn't find anything,"
not a wrong answer.

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
