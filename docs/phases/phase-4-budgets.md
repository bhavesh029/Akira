# Phase 4 — Budgets & Spending Limits

**Status:** ⬜ Not started.
**Depends on:** Phase 1 (budget spend calculations must gate on `reviewed = true`,
via Phase 0's `baseFilteredQuery`).

## Goal

Per-category monthly budgets with spend-vs-limit status and in-app alerts — one of
the four must-have MVP features for the customer to track their financial decisions.

## Decisions already locked in

- **MONTHLY period only for MVP** — matches the existing `dateRange` conventions
  elsewhere in the app; no weekly/custom-period budgets in this pass.
- **In-app alerts only** — a badge/banner at 80%/100% of limit, computed on-demand.
  No notification channel (email/push) exists anywhere in this codebase today; not
  adding one just for this.

## Planned implementation

1. New `backend/src/entities/budget.entity.ts`: `userId`, `category`, `limit_amount`
   (decimal, Phase 0's `DecimalTransformer`), `period` (`MONTHLY`), timestamps. New
   migration.
2. New `backend/src/budgets/` module mirroring the `accounts` module shape exactly
   (module/service/controller/DTOs via `PartialType`, `AuthGuard('jwt')` +
   `req.user.id` scoping — same pattern as every other resource module).
3. `GET /budgets/status` computes actual spend per category for the current month
   using Phase 0's `AnalyticsService.baseFilteredQuery` helper (category filter +
   `reviewed = true`) — **no new independent query logic**; reuse, don't
   reimplement.
4. Frontend: `frontend/src/api/budgets.ts` (mirror `accounts.ts`),
   `frontend/src/pages/BudgetsPage.tsx` + CSS (new route/nav), progress bars reusing
   existing CSS primitives (`badge-*`, etc.). Small non-paginated list → use the
   local-state-patch refresh convention (like `AccountsPage.tsx`), not the
   `listVersion` counter pattern (that's for paginated lists like
   `TransactionsPage.tsx`).

## Verification plan

- Create a budget for a category, add reviewed transactions in that category,
  confirm the status endpoint's spend total matches a manual calculation.
- Confirm unreviewed transactions in that category are excluded from the spend
  total.
- Confirm crossing 80%/100% of the limit triggers the visual alert.

## Critical files

`backend/src/entities/budget.entity.ts` (new), `backend/src/budgets/` (new),
`backend/src/analytics/analytics.service.ts` (reuse only, no new query logic),
`frontend/src/api/budgets.ts` (new), `frontend/src/pages/BudgetsPage.tsx` (new).
