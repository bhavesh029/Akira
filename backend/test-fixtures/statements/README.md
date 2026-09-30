# Bank statement samples (local only — never committed)

Drop real or realistic redacted bank statement text here, one file per bank,
named `<bank>-sample.txt` (e.g. `icici-sample.txt`, `hsbc-sample.txt`).

Before adding a file:
- Redact account numbers, names, and any other personal details.
- Prefer the raw extracted text (what `pdf-parse` would produce), not the
  original PDF — this is what the bank parsers in
  `backend/src/documents/parsers/` actually operate on.

This whole directory is gitignored (see the repo root `.gitignore`), so
nothing placed here ever leaves your machine via version control — but it
stays on disk, so it can be read directly in a Claude Code session to
implement and test the real parser for that bank (see
`docs/phases/phase-2-bank-parsers.md`).
