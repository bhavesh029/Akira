# Phase 2 — Harden the 6 Bank Parsers

**Status:** 🚧 **Partially done.** ICICI, HSBC, UCO, and Axis are implemented and
verified against real sample statements. PNB is still blocked on a sample; HDFC's
placeholder regex is still unverified (no sample provided for either).

## What's done

- **ICICI** (savings account) and **UCO** (savings account): real parsers. The text
  extraction loses the debit/credit column — each line ends with two bare numbers
  (amount, running balance) in an order that isn't even consistent line-to-line —
  so `backend/src/documents/parsers/balance-delta.util.ts` resolves both against
  the running balance arithmetically, only reporting a transaction when it
  provably reconciles. Verified: 342/344 real transaction-shaped lines in the
  ICICI sample resolved correctly; UCO's computed totals match the statement's own
  printed deposit/withdrawal/closing-balance figures exactly.
- **HSBC** and **Axis**: the samples provided turned out to be **credit card**
  statements, not savings/current accounts — tab-separated (HSBC, with a trailing
  `CR` marker and no year on each line) and single-line-with-`Dr`/`Cr`-marker
  (Axis) respectively. Both verified: totals reconcile exactly against each
  statement's own printed summary figures.
- If an HSBC/Axis *savings* statement (a different layout than the sample
  provided) is ever uploaded, the parser is expected to match zero lines and fall
  back to Gemini automatically (Phase 0's existing safety net), not misparse.

## Still blocked

- **PNB**: no sample provided yet — still a stub returning `[]` (falls back to
  Gemini).
- **HDFC**: placeholder regex, never verified against a real sample — unchanged
  this pass since none was provided.

## What's needed to unblock the rest

A real, or realistic/representative, statement text sample for PNB (and ideally
one for HDFC to verify the existing regex) — redact account numbers and personal
details first. Drop in `backend/test-fixtures/statements/` (gitignored) and the
corresponding parser gets implemented/verified against it directly.

## Remaining work (PNB, and verifying HDFC)

1. Implement real `parse()` logic once a sample exists, following the same
   pattern as ICICI/UCO/HSBC/Axis (reuse `balance-delta.util.ts` if PNB's layout
   also loses its debit/credit column the same way).
2. Add real unit tests using synthetic text that mirrors the real sample's
   structure (never commit the actual sample text — it stays in the gitignored
   `test-fixtures/` folder).
3. `BankParser.parse()`'s return shape could later be widened to include
   `openingBalance`/`closingBalance` if Phase 1's reconciliation work wants
   parser-reported balances rather than deriving them itself — not done yet,
   revisit when Phase 1 is picked up.

## Verification plan

- Upload a real statement for that bank → confirm it goes through the
  deterministic parser (check logs for the absence of "falling back to Gemini").
- Confirm every transaction and the reconciled balance match the actual statement,
  line by line, for at least one real sample per bank.

## Critical files (when resumed)

`backend/src/documents/parsers/*.parser.ts`, `bank-parser.interface.ts`,
`parser.factory.ts`, `extraction.service.ts`.
