# Phase 2 — Harden the 6 Bank Parsers

**Status:** ⬜ **Deferred — blocked on you.** Do not start this phase's parser
implementation work without real/representative sample statement text.

## Why this is blocked

5 of the 6 bank parsers (`backend/src/documents/parsers/{icici,hsbc,uco,pnb,axis}.parser.ts`)
are stubs: `canParse()` does a bank-name substring match, `parse()` unconditionally
`return []`. HDFC's parser has a real regex but it's explicitly marked
`// TODO: to be implemented once a sample PDF text is provided` and has never been
verified against a real statement.

Guessing column layouts for the other 5 banks without real samples would just
introduce a *different* kind of silent wrong-extraction — the opposite of the
accuracy goal this whole MVP pass is about. Phase 0's fallback fix (falls back to
Gemini when a matched parser returns nothing) plus Phase 1's mandatory
reconciliation/review are the interim safety net.

## What's needed to unblock this

For each of ICICI, HSBC, UCO, PNB, Axis (and to verify HDFC): a real, or
realistic/representative, statement text sample — redact account numbers and
personal details first. Share it and the corresponding parser gets implemented and
tested against it directly.

## Planned implementation once unblocked

1. Implement real `parse()` logic per bank in
   `backend/src/documents/parsers/{bank}.parser.ts` against the real sample text.
2. Widen `BankParser.parse()`'s return shape (`bank-parser.interface.ts`) from
   `ExtractedTransaction[]` to include `openingBalance`/`closingBalance`, feeding
   Phase 1's reconciliation check. Coordinate with however Phase 1 shaped that
   plumbing so it isn't built twice.
3. Add real unit tests per parser using the actual sample fixture text — this is
   the single highest-leverage place in the whole plan to add test coverage, since
   wrong parsing directly corrupts financial data. See
   `.agents/rules/build_workflow.md` for the testing bar every phase should meet.

## Verification plan

- Upload a real statement for that bank → confirm it goes through the
  deterministic parser (check logs for the absence of "falling back to Gemini").
- Confirm every transaction and the reconciled balance match the actual statement,
  line by line, for at least one real sample per bank.

## Critical files (when resumed)

`backend/src/documents/parsers/*.parser.ts`, `bank-parser.interface.ts`,
`parser.factory.ts`, `extraction.service.ts`.
