---
trigger: always_on
description: How to build the phased MVP plan safely — what to do, what never to do, and the verification bar for each phase.
---
# Akira Build Workflow Rules

This project is being built in phases tracked under `docs/phases/` (index:
`docs/phases/README.md`), against the approved MVP plan. These rules apply to any
agent doing implementation work in this repo, in addition to `auto_read_context.md`.

## Follow the phases in order

- Check `docs/phases/README.md` for current status before starting new work. Don't
  jump ahead to a later phase's implementation unless the user explicitly asks for
  that specific phase out of order.
- **Phase 2 (bank parser hardening) is blocked.** Do not implement real parsing
  logic for ICICI, HSBC, UCO, PNB, or Axis without the user first providing
  real/representative sample statement text for that specific bank. Guessing a
  column layout is exactly the silent-wrong-extraction failure mode this whole MVP
  pass exists to eliminate.
- When a phase is completed, update its doc under `docs/phases/` (status + "What
  was built" section, reflecting what actually shipped, not what was planned) and
  the corresponding section of `TESTING.md`.

## Financial-correctness invariants (do not violate without asking first)

- **An LLM must never be the source of a number shown to the user as fact.**
  Follow the pattern already established in `AnalyticsService.financeChat()`: the
  LLM only parses intent/filters; a deterministic SQL/JS aggregation computes the
  actual number. This applies to Phase 3's RAG answers, Phase 5's recurring-bill
  amounts/frequencies, and anything similar — the LLM may *identify* a candidate
  (e.g. "this looks like a recurring vendor") but must never *state* the amount or
  cadence itself.
- **Reuse `AnalyticsService.baseFilteredQuery`** (and, once Phase 1 lands, its
  `reviewed = true` gate) for any new transaction-derived aggregate — budgets
  status, net worth, recurring-bill detection. Do not write a new independent
  `userId`/`accountId`/`dateRange` filter block; that duplication is exactly what
  Phase 0 removed and it must not come back.
- **Any new money/decimal column must use `DecimalTransformer`**
  (`backend/src/entities/transformers/decimal.transformer.ts`), not a bare
  `@Column({ type: 'decimal', ... })`.
- **Any schema change ships as a migration** (`npm run migration:generate`), never
  an entity edit relied on via `synchronize` alone — `synchronize` is dev-only
  convenience, not the source of truth for shipped schema.

## Tooling discipline (a real incident happened here — do not repeat it)

- **Never run `npm run lint` (or any bare `eslint --fix` / formatter) unscoped.**
  `npm run lint` runs `eslint --fix` across the entire `src/` tree. If the
  codebase doesn't already conform to its own prettier config (it currently
  doesn't), this silently reformats dozens of unrelated files and produces a huge,
  unreviewable diff mixed in with real changes — this already happened once mid-
  build and had to be manually untangled file by file.
  - To check for lint errors: run `npx eslint <the exact files you touched>`
    **without** `--fix`, and read the output.
  - To fix a lint error: fix it by hand in the file you're already editing, or run
    `--fix` scoped to that exact file only (`npx eslint path/to/file.ts --fix`),
    never the whole-repo `npm run lint` script.
- Before finishing any unit of work, confirm the diff (`git status` / `git diff
  --stat`) only touches files relevant to the current task. If something else
  shows as modified, investigate before proceeding — don't assume it's fine.

## Git safety

- Never run destructive git commands (`checkout --`, `reset --hard`, `clean -f`,
  `stash drop`, force-push) without the user explicitly confirming that specific
  action. If recovering from a mistake requires one of these, prefer a read-only
  route first (`git show <ref>:<path> > <path>` to restore specific file content
  without touching git's own history/stash state) and explain to the user what
  happened.

## Verification bar before calling a phase "done"

1. `cd backend && npm run build` — clean, no TypeScript errors.
2. `npm test` — no *new* failures compared to the pre-existing baseline (as of
   Phase 0: 5 pre-existing scaffold-test failures, 1 passing — see
   `docs/phases/phase-0-foundation.md`). New code should have real tests, not rely
   on the absence of new failures alone.
3. `npx eslint <touched files>` (no `--fix`) — no new error *categories* beyond
   what's already pervasive in the untouched codebase.
4. New non-trivial logic (date/money math, parsers, reconciliation, detection
   heuristics) has real Jest unit tests with mocked dependencies — not a vacuous
   `should be defined` scaffold. See `backend/src/analytics/date-range.util.spec.ts`
   and `backend/src/entities/transformers/decimal.transformer.spec.ts` (added
   alongside this rules file) as the pattern to follow.
5. Relevant docs updated: `docs/phases/phase-N-*.md` and `TESTING.md`.

## Scope discipline

- Only touch files relevant to the current task. Don't restyle, refactor, or
  "clean up" unrelated code while implementing a feature.
- Don't add a new dependency unless the approved plan already calls for it
  (e.g. Phase 3's RAG work explicitly avoids new chunking/vector libraries in favor
  of hand-rolled code + the already-installed `pgvector`/`@google/generative-ai`
  packages — don't introduce `langchain` or similar without asking first).

## When a decision is already made

The phase docs under `docs/phases/` record decisions already locked in via user
Q&A (bulk-confirm UX, reconciliation tolerance, RAG scope, detection thresholds,
etc.). Follow what's written there instead of re-deciding. If a genuinely new
decision is needed that isn't covered, ask the user — don't assume.
