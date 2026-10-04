# Bug Backlog

Full audit of known bugs as of the Phase 0 PR (#33), categorized by severity
(user/data impact if left alone) and effort (rough size to fix). Fixed in
`bug/fixes-and-optimization` before this doc existed: silent empty-parser data
loss, `Transaction.amount` returned as a string, timezone-dependent date-range
math, duplicated analytics filter logic, stale AI-insights cache on account
deletion — see `docs/phases/phase-0-foundation.md`.

**Status legend:** ⬜ Open · 🚧 In progress · ✅ Fixed

---

## Critical

| # | Bug | Effort | Status |
|---|---|---|---|
| 1 | 5 of 6 bank parsers (ICICI/HSBC/UCO/PNB/Axis) are stubs returning `[]` — accuracy for those banks depends entirely on Gemini, unverified against real statements | High (blocked — needs real sample statements, see below) | 🚧 Partially fixed — ICICI, HSBC, UCO, and Axis now have real parsers, each verified against a real (redacted) sample statement: ICICI/UCO (savings accounts) resolve amount vs. running balance via `balance-delta.util.ts` since the extracted text loses the debit/credit column, and every line is checked to actually reconcile against the running balance before being reported (342/344 real transaction-shaped lines in the ICICI sample, UCO's totals match the statement's own printed deposit/withdrawal/closing-balance figures exactly); HSBC and Axis (credit-card statements, not savings accounts) parse their tab/Dr-Cr-marker formats directly. **PNB remains a stub** — no sample provided yet. If an HSBC/Axis *savings* statement is ever uploaded (vs. the credit-card format the sample provided), the parser is expected to match zero lines and fall back to Gemini automatically, not silently misparse. |
| 2 | No DB transaction wrapping in `extraction.service.ts` — saving transactions and updating `Document.status` are separate non-atomic writes; a crash mid-extraction can leave transactions saved but the document stuck on `PROCESSING`, or (if the status update fails after transactions saved) the document marked `FAILED` while transactions already exist | Medium | ✅ Fixed in this branch |
| 3 | CSV upload is accepted (`documents.controller.ts` allows `text/csv`) but `extraction.service.ts` has no CSV-specific path — it was sent to Gemini Vision as image `inlineData`, which is not a supported use of that API | Low | ✅ Fixed in this branch |

## High

| # | Bug | Effort | Status |
|---|---|---|---|
| 4 | No rate limiting on `/auth/login` or `/auth/register` | Low | ✅ Fixed — `@nestjs/throttler`, global 60/min default + a stricter 5/min override on both auth endpoints. Verified via real HTTP requests in `auth.throttling.spec.ts` (not a mock of the throttling behavior). |
| 5 | `getAiInsights()` lets Gemini state subscription amounts and anomaly figures directly, never cross-checked against real transaction data | Medium (tracked as Phase 5) | ✅ Interim fix — every subscription/anomaly Gemini returns is now cross-checked against the real transactions sent to it: subscription amounts are replaced with the real (most recent) matching transaction's amount, or dropped if no transaction matches; anomaly sentences are dropped unless a mentioned figure matches a real transaction amount. The full persisted Recurring Bills feature (Phase 5) is still a separate, larger effort. |
| 6 | `UserRole` (ADMIN/USER) is stored and put in the JWT but never checked anywhere — no `RolesGuard`, no admin-only route | Low to remove, Medium to implement | ✅ Fixed — real `RolesGuard` + `@Roles()` decorator added (`backend/src/auth/roles.guard.ts`/`roles.decorator.ts`), tested both as a unit (every branch) and end-to-end via real HTTP requests against a test controller. Not yet applied to any route, since no admin-only feature exists in this app today — ready to drop onto one with `@UseGuards(AuthGuard('jwt'), RolesGuard) @Roles(UserRole.ADMIN)` whenever that's needed. |
| 7 | No password-reset flow at all | Medium | ⬜ **Deferred** — this repo has no email-sending provider integrated at all (no SendGrid/SES/Resend/SMTP config anywhere); revisit once one is chosen. |
| 8 | `transactions.controller.ts`'s `type` query param is passed straight to a Postgres enum column with no validation — an invalid value raises an unhandled 500 instead of a 400 | Low | ✅ Fixed — replaced the individual untyped `@Query('x')` params with a validated `FindTransactionsQueryDto` (`@IsEnum`, `@IsInt`, `@IsDateString`, etc.), which the existing global `ValidationPipe` now enforces automatically. Verified via real HTTP requests in `transactions.controller.spec.ts`, including that an unrecognized query param is now also rejected (`forbidNonWhitelisted`). |
| 9 | No JWT revocation/refresh mechanism | Medium | ⬜ **Deferred** — a full refresh-token system is a real auth-architecture change, not a quick fix; short-lived `JWT_EXPIRATION` (already configurable) is the accepted interim mitigation for the MVP. |

## Medium

| # | Bug | Effort | Status |
|---|---|---|---|
| 10 | No duplicate-document detection on upload | Low | ⬜ |
| 11 | `Document.accountId == null` silently drops all extracted transactions with only a log line, no user-facing error | Low (ties into #13) | ⬜ |
| 12 | No `Document.error_message` — a `FAILED` document gives no reason | Low (planned in Phase 1's migration) | ⬜ |
| 13 | Wrong PDF password isn't distinguished from any other extraction failure | Low | ⬜ |
| 14 | `category` is a free-form nullable string with no canonicalization | Medium | 🚧 Partially fixed — deterministic keyword-based categorization (`backend/src/documents/categorization.util.ts`) now runs uniformly at extraction time regardless of source (any bank parser or Gemini), covering ~20 real-world categories plus a "Transfer" fallback for person-to-person UPI payments (sending/receiving money with a friend, street vendors) that previously landed in "Other". A `POST /transactions/recategorize` endpoint re-runs it over already-saved transactions. Still not a canonical/enforced category list at the DB or DTO level — `category` is still a free-form string column, and an unrecognized vendor can still land in "Other"; manual correction via `PATCH /transactions/:id` remains the fallback for those. |
| 15 | `financeChat`'s category filter uses `ILIKE '%term%'` substring matching, can match unrelated categories | Low | ⬜ |
| 16 | `from`/`to` date filters on `GET /transactions`: supplying only one is silently ignored entirely | Low | ⬜ |
| 17 | No `documentId` filter on the transactions API despite the field existing on the entity | Low | ⬜ |
| 18 | Deleting a `Document` mid-extraction can race with the fire-and-forget background job updating a row that no longer exists | Low | ⬜ |
| 19 | No CI pipeline | Low–Medium | ✅ Fixed — `.github/workflows/ci.yml` runs on every PR (and on push to `main`): backend build + scoped lint (changed files only, blocking) + unit tests with coverage thresholds + e2e tests against a real Postgres service container; frontend build + scoped lint. |
| 29 | *(found while wiring up CI)* `npm run test:e2e` was completely broken — `uuid` v13 is ESM-only and the e2e Jest config had no `transformIgnorePatterns` for it, so the whole suite failed to even load | Low | ✅ Fixed — added `transformIgnorePatterns` to `backend/test/jest-e2e.json`; also fixed the e2e spec never closing the Nest app (`afterEach(() => app.close())`), which left a dangling DB connection and made Jest hang after the run. |
| 20 | Zero test coverage on `documents.service.ts`, `documents.controller.ts`, `transactions.service.ts`, `accounts.service.ts`, `gemini.service.ts` | Medium | 🚧 Partially fixed — `gemini.service.ts` (98.6%), `extraction.service.ts` (92.5%), `analytics.service.ts` (100%), `transactions.service.ts` (100%), and all 6 bank parsers (100%) now have full suites with enforced coverage thresholds (see `backend/package.json`'s `jest.coverageThreshold`). `documents.service.ts`, `documents.controller.ts`, `accounts.service.ts`/`.controller.ts`, and `transactions.controller.ts` remain at 0%. |
| 21 | Two unrelated concepts are both called "anomalies" (`getSummary`'s deterministic top-5-debits vs. `getAiInsights`'s LLM-narrated sentences) | Low | ⬜ |
| 22 | `.claude/hooks/check-lint-scope.sh` false-positives on prose containing the phrases it's meant to block | Low | 🚧 Partially fixed — the `xargs`-piped eslint pattern (the actual scoped-fix workflow) is now explicitly allowed. Still open: literal glob syntax (e.g. `**/*.spec.ts`) appearing anywhere in prose (a commit message, a code comment) still false-positives, since the hook can't distinguish "an actual shell command target" from "text that happens to contain `**`." Workaround: reword to avoid double-asterisk glob notation in commit/PR text. |

## Low

| # | Bug | Effort | Status |
|---|---|---|---|
| 23 | `compare_amount`'s "exactly" comparator uses a float-tolerance hack instead of exact decimal comparison | Low | ⬜ |
| 24 | `AiInsightsCacheService` is in-memory only — won't invalidate correctly across multiple backend instances | Medium | ⬜ |
| 25 | `Number()` on SQL `SUM()` results loses precision above 2^53 (unreachable at personal-finance scale) | Low (not worth doing now) | ⬜ |
| 26 | Frontend has no error boundary | Low | ⬜ |
| 27 | Chat widget has no persistence — refresh loses the conversation | Low | ⬜ |
| 28 | `backend/statement.pdf` still sits untracked in the working tree | Low | ⬜ |
| 30 | *(found while debugging a live "AI insights blank" report)* `GeminiService.generateInsights()` had no error handling around the actual `generateContent()` call — only around JSON-parsing its response. A failed API call (billing/quota exhausted, outage, bad key) propagated as an unhandled rejection all the way to an opaque 500, leaving the dashboard's insights panel silently blank with no indication why. | Low | ✅ Fixed — wrapped in a try/catch that returns a graceful, informative `summary` message instead (distinguishing a billing/quota failure from any other failure), matching the same non-throwing shape already used for JSON-parse failures. |

---

## Sample bank statements for Phase 2 (bug #1)

Bug #1 (hardening the 5 stub bank parsers) is blocked on real/representative
statement text — see `docs/phases/phase-2-bank-parsers.md`.

**Where to put them:** `backend/test-fixtures/statements/` — this directory is
gitignored (never committed, never leaves your machine via version control),
but is on disk so it can be read directly during a session. Redact account
numbers and personal details first. One file per bank is enough to start,
named `<bank>-sample.txt` (e.g. `icici-sample.txt`), containing the raw
extracted text (or a realistic excerpt of it) — not the original PDF.
