# Build Phases — Index

This directory tracks the Akira B2C MVP build phase by phase: what each phase set
out to do, what actually got built, key design decisions, and links to how to test
it. It's a build log, not a test script — for exact manual test steps see
[`../../TESTING.md`](../../TESTING.md). For overall architecture see
[`../../PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md).

| Phase | Title | Status |
|---|---|---|
| 0 | [Foundation & correctness fixes](./phase-0-foundation.md) | ✅ Done |
| 1 | [Reconciliation + mandatory review](./phase-1-reconciliation-review.md) | ⬜ Not started |
| 2 | [Harden the 6 bank parsers](./phase-2-bank-parsers.md) | 🚧 Partially done (ICICI/HSBC/UCO/Axis hardened; PNB blocked, HDFC unverified) |
| 3 | [RAG (grounded chat + semantic search)](./phase-3-rag.md) | ⬜ Not started |
| 4 | [Budgets & spending limits](./phase-4-budgets.md) | ⬜ Not started |
| 5 | [Recurring bills / subscriptions](./phase-5-recurring-bills.md) | ⬜ Not started |
| 6 | [Net worth / multi-account trend](./phase-6-net-worth.md) | ⬜ Not started |

**Rules for how phases get built:** see
[`../../.agents/rules/build_workflow.md`](../../.agents/rules/build_workflow.md).

**Update convention:** each phase's doc gets updated (status flipped, "What was
built" section filled in) as work lands — not written speculatively ahead of the
actual code.
