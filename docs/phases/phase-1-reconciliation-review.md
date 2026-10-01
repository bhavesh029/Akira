# Phase 1 — Reconciliation + Mandatory Review Workflow

**Status:** ⬜ Not started.
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
