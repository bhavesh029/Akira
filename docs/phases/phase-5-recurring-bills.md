# Phase 5 — Recurring Bills / Subscriptions

**Status:** ⬜ Not started.
**Depends on:** Phase 1 (detection must run over reviewed transactions only).

## Goal

Replace the ephemeral, unpersisted, LLM-stated `getAiInsights().subscriptions` field
(`backend/src/analytics/analytics.service.ts`) with a real, persisted feature: a
`RecurringBill` entity whose amount/frequency/next-due-date are derived
deterministically from actual transaction history, not stated by the LLM.

## Decision already locked in

**On-demand detection only, ≥3 occurrences.** The user triggers detection (opening
the Recurring Bills page, or a "Scan" action). No background job/cron infra exists
in this codebase today and none is being added just for this. A vendor is flagged
as recurring once it repeats ≥3 times at a consistent interval (±3 days for
monthly, scaled proportionally for other cadences).

## Planned implementation

1. New `backend/src/entities/recurring-bill.entity.ts`: `userId`, `accountId`,
   `vendor_name`, `amount` (decimal — **derived from real transactions, never
   LLM-stated**), `frequency` enum, `next_due_date`, `status`
   (`CANDIDATE`|`CONFIRMED`|`DISMISSED`), a last-seen transaction reference. New
   migration.
2. New `backend/src/recurring-bills/recurring-bill-detection.service.ts`
   (on-demand only): groups reviewed transactions by normalized description (reuse
   the normalization logic already used in `extraction.service.ts`'s
   `transactionFingerprint()` — extract it into a shared util rather than
   duplicating) and amount similarity, flags ≥3 occurrences at a consistent
   interval as a `CANDIDATE`. If Gemini is used at all here, it only labels
   ambiguous vendor strings — **it must never state the amount or cadence**; those
   come from real transaction data. This is the same "no LLM-computed numbers"
   principle Phase 0/1 established for the rest of the app.
3. CRUD + confirm/dismiss endpoints. Dismissed vendors must not resurface on future
   scans (store the dismissal).
4. Retire the `subscriptions` field from `getAiInsights()`'s prompt/response once
   this ships, so there's exactly one source of truth for "recurring bills" instead
   of two competing ones.
5. Frontend: `frontend/src/api/recurring-bills.ts` (new),
   `frontend/src/pages/RecurringBillsPage.tsx` + CSS (new route/nav, includes the
   "Scan" trigger action), and an "upcoming bills" widget on `DashboardPage.tsx`
   sorted by `next_due_date`.

## Verification plan

- Feed a transaction history with an obvious monthly subscription (same vendor,
  same amount, ~30-day cadence) → confirm it's detected with correct next-due-date
  math, not an LLM guess.
- Confirm dismissing a candidate stops it from resurfacing on the next scan.
- Confirm the shown amount always matches actual transaction amounts.

## Critical files

`backend/src/entities/recurring-bill.entity.ts` (new),
`backend/src/recurring-bills/` (new), `backend/src/analytics/analytics.service.ts`
(retire `subscriptions` from `getAiInsights`), `backend/src/documents/extraction.service.ts`
(shared description-normalization util extraction), `frontend/src/api/recurring-bills.ts`
(new), `frontend/src/pages/RecurringBillsPage.tsx` (new).
