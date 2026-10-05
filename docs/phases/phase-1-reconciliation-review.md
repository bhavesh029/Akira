# Phase 1 — Reconciliation + Mandatory Review Workflow

**Status:** ✅ Done.
**Depends on:** Phase 0 (shared query helper, decimal transformer, migration tooling).

## Goal

Extraction/calculation must be provably correct. Extracted transactions always land
as `reviewed: false` and never count toward analytics/budgets/net-worth until the
user explicitly confirms them. A balance-reconciliation check (extracted sum vs. the
statement's own opening/closing balance) informs — but does not replace — that
review step.

## Decisions already locked in (from user Q&A, do not re-litigate without asking)

- **Reconciliation matches → one-click bulk confirm.** A single "Confirm all N"
  button when the extracted sum reconciles against the statement's stated closing
  balance.
- **Reconciliation mismatches, or no balance found → per-row review required.** No
  bulk-confirm shortcut in this case; the user must review/edit individually.
- **Unreviewed transactions are visible, not hidden.** They appear in the normal
  Transactions list with an "unreviewed" badge, but are excluded from every
  analytics/budget/net-worth calculation until confirmed.
- **Reconciliation tolerance:** a small absolute tolerance (~₹5), not a percentage —
  bank ledgers are exact, so a fixed tolerance only absorbs paise-level rounding.

## Planned schema (one migration)

- `Transaction.reviewed: boolean` (default `false`).
- `Document` gains `opening_balance` / `closing_balance` / `reconciled_delta`
  (decimal, nullable, reuse Phase 0's `DecimalTransformer`), `reconciliation_status:
  enum('NOT_APPLICABLE'|'MATCHED'|'MISMATCH')`, and `error_message` (text, nullable
  — carried over from Phase 0's deferred item so `FAILED` documents have a reason).

## Planned implementation

1. **Capture balances at extraction time** (`backend/src/documents/gemini.service.ts`)
   — extend the extraction prompt/response to also return document-level
   `opening_balance`/`closing_balance` when present in the statement (omit rather
   than guess, matching the existing prompt style). HDFC's parser already captures
   a trailing numeric group (presumably a running balance) that's currently
   discarded — wire it into `closing_balance` = the last captured value.
2. **Reconciliation check** (`backend/src/documents/extraction.service.ts`) — after
   saving extracted transactions (still `reviewed: false` by default), compute
   `opening_balance + Σ(CREDIT) − Σ(DEBIT)` vs `closing_balance` within the ₹5
   tolerance, write `reconciliation_status`/`reconciled_delta` onto the `Document`
   row in the same update that sets `COMPLETED`.
3. **Gate all analytics on `reviewed = true`** — add `.andWhere('tx.reviewed =
   true')` to Phase 0's `AnalyticsService.baseFilteredQuery` helper. This is the
   single choke point that enforces the gate across summary, cashflow, AI insights,
   and finance chat at once.
4. **Review UI:**
   - `frontend/src/api/transactions.ts` — add `documentId?: number` to
     `TransactionFilters` (currently missing despite `TransactionItem.documentId`
     already existing).
   - New endpoint `PATCH /documents/:id/confirm-review` (bulk-confirm all of a
     document's unreviewed transactions in one transaction) plus per-row confirm
     via the existing `PATCH /transactions/:id` (`reviewed` field added to
     `UpdateTransactionDto`).
   - New `frontend/src/pages/ReviewPage.tsx` (+ CSS), reached via a new "Review"
     action on completed document rows in `DocumentsPage.tsx`. Shows the
     reconciliation banner and either the bulk-confirm button or per-row
     edit/confirm controls per the decision above.
   - `TransactionsPage.tsx` gets an "unreviewed" badge (reuse existing `badge-*`
     CSS) on any `reviewed: false` row.

## Verification plan (see `TESTING.md` for exact steps once built)

- Upload a statement with a clean reconciling balance and one deliberately off;
  confirm `Document.reconciliation_status` lands correctly for each.
- Confirm `GET /analytics/summary` totals change only after transactions are
  confirmed, never before.
- Confirm bulk-confirm flips all of a document's rows in one transaction.

## Critical files

`backend/src/entities/transaction.entity.ts`, `backend/src/entities/document.entity.ts`,
`backend/src/documents/extraction.service.ts`, `backend/src/documents/gemini.service.ts`,
`backend/src/analytics/analytics.service.ts`, `frontend/src/api/transactions.ts`,
`frontend/src/pages/DocumentsPage.tsx`, `frontend/src/pages/ReviewPage.tsx` (new),
`frontend/src/pages/TransactionsPage.tsx`.

## What was built

Matches the plan above with one deliberate deviation, plus a couple of
implementation details worth recording:

- **Balance capture is bank-agnostic, not HDFC-specific.** Rather than widening
  `BankParser.parse()`'s return shape to carry HDFC's discarded trailing balance
  group (as originally planned), `GeminiService.extractDocumentBalances()` runs once
  per text-based document — independently of which deterministic parser matched (or
  whether one matched at all) — and looks for an explicitly-printed opening/closing
  balance. This covers all banks uniformly instead of just HDFC, at the cost of one
  extra Gemini call per document, and needed no `BankParser` interface change.
  Scanned/image (vision-path) documents have no raw text to run this against, so
  they land on `reconciliation_status: NOT_APPLICABLE` — which correctly routes them
  to mandatory per-row review, the same safe fallback as "no balance found."
- **Two base-query choke points, not one.** `AnalyticsService` has
  `baseFilteredQuery` (used by `getSummary`/`getAiInsights`) and a separate
  `baseTxQuery` used only by `financeChat`'s deterministic-intent path (different
  filter shape: explicit `from`/`to` + `accountIds[]` rather than a `dateRange`
  keyword). Both now carry `.andWhere('tx.reviewed = true')` independently, since
  neither call through the other.
- **Manually-created transactions (`POST /transactions`) are `reviewed: true`
  immediately** — they carry none of the extraction uncertainty the gate exists
  for, so forcing them through per-row review would be pure friction.
- **Bulk confirm is one DB transaction** (`PATCH /documents/:id/confirm-review`,
  `DocumentsService.confirmReview`), not N sequential `PATCH /transactions/:id`
  calls from the frontend.
- The migration (`backend/src/migrations/1791136200000-ReconciliationAndReview.ts`)
  was hand-written and verified independently against a scratch Postgres database
  (clean `up`, clean `down`) rather than CLI-generated — the local dev DB's
  `synchronize: true` had already applied the equivalent schema by the time the
  migration was written, so there was nothing left for `migration:generate` to diff.
- Verified end-to-end against the real backend (live Gemini calls, not mocks): a
  MATCHED statement reconciled to the exact expected delta (0), a deliberately-off
  statement correctly computed `MISMATCH` with the exact expected delta, analytics
  totals excluded unreviewed transactions and included them immediately after
  confirm, and the Review page (bulk confirm + per-row edit/confirm) was exercised
  in a real browser.
