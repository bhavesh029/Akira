# Phase 6 — Net Worth / Multi-Account Balance Trend

**Status:** ⬜ Not started.
**Depends on:** Phase 1 (balance derivation must use `reviewed = true` transactions
only).

## Goal

Derived (never stored/duplicated) balance per account, and a net-worth trend across
all accounts over time.

## Decision already locked in

**No stored `current_balance` column, ever.** Always derive it as `starting_balance
+ Σ(reviewed CREDIT) − Σ(reviewed DEBIT since starting_balance_date)` so it can
never drift out of sync with the actual transaction ledger. `starting_balance` is
**editable anytime**, not required at account-creation time — many users won't know
their exact starting balance when they first add an account.

## Planned implementation

1. `Account` gains `starting_balance` (decimal, Phase 0's `DecimalTransformer`) and
   `starting_balance_date`. New migration.
2. New `GET /analytics/net-worth?dateRange=` — per-account balance-over-time via
   cumulative sum of reviewed transactions (built on Phase 0's
   `AnalyticsService.baseFilteredQuery` helper), summed across accounts per date
   point. Credit card / loan accounts (`AccountType.CREDIT_CARD` /
   `AccountType.LOAN` already exist) **subtract** from total net worth — they're
   liabilities, not assets.
3. Frontend: `AccountsPage.tsx` shows each account's derived current balance (no
   balance field/display exists there today — this is fully greenfield on the
   frontend too); new `frontend/src/pages/NetWorthPage.tsx` + CSS (new route/nav)
   with a Recharts line chart, following `DashboardPage.tsx`'s existing direct
   Recharts-composition style (no shared chart wrapper exists in this codebase —
   don't introduce one just for this page).

## Verification plan

- Create an account with a known starting balance, add reviewed transactions →
  confirm the computed balance matches manual arithmetic.
- Confirm unreviewed transactions don't affect the computed balance.
- Confirm a credit-card account's balance correctly subtracts from total net worth
  rather than adding to it.

## Cross-cutting note

Net worth summed across accounts implicitly assumes single-currency (INR) — no
`currency` column exists anywhere in this codebase, consistent with the app's
B2C-India-only scope. Worth re-confirming this assumption still holds before
building this phase, since it's the one place multiple accounts' balances get
added together directly.

## Critical files

`backend/src/entities/account.entity.ts`, `backend/src/accounts/accounts.service.ts`
/ `accounts.controller.ts` / DTOs, `backend/src/analytics/analytics.service.ts`,
`frontend/src/api/accounts.ts`, `frontend/src/api/analytics.ts`,
`frontend/src/pages/AccountsPage.tsx`, `frontend/src/pages/NetWorthPage.tsx` (new).
