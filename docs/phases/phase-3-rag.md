# Phase 3 — RAG (Grounded Chat + Semantic Search + Fine-Print Q&A)

**Status:** ✅ Done.
**Depends on:** Phase 1 ✅ done — the `reviewed = true` gate exists now
(`AnalyticsService.baseFilteredQuery`/`baseTxQuery`). Any new transaction-touching
query this phase adds (e.g. "semantic search across transactions") should reuse or
replicate that gate the same way, so unreviewed/unconfirmed transactions never leak
into a RAG answer either.

## Goal

One retrieval-and-generation path, grounded in the user's own raw statement text and
structured transactions, covering all three requested use cases in a single feature:
(a) grounded finance chat over raw statement text (narrations, fee lines, footnotes
that never become structured transaction rows), (b) semantic search across all the
user's statements/transactions, (c) Q&A over statement fine-print/terms.

## Decision already locked in

Route through the **existing** `/analytics/chat` endpoint as a fallback when
`parseFinanceChatIntent()` doesn't match a known deterministic numeric intent — one
chat UI, no new frontend surface needed beyond the response shape. Keep this new
path **separate in code** from `financeChat`'s existing deterministic-SQL path, so
the "LLM never states a number the user sees as a fact" guarantee there is never put
at risk by this change.

## Planned implementation

1. **Persist raw statement text** — add `Document.raw_text` (text, nullable). Today
   the extracted PDF text is transient inside `ExtractionService.process()` and
   discarded; storing it avoids re-parsing and gives citation snippets for chat
   answers.
2. **Chunking** — new `backend/src/documents/chunking.util.ts`. No chunking library
   is installed; hand-roll a splitter, ~800 chars with ~150 char overlap, splitting
   on line boundaries where possible. (Chunk size/overlap are tunable later without
   a schema change — not worth debating precisely up front.)
3. **Embeddings** — `GeminiService.embedText()` / `embedBatch()` using the
   already-installed SDK's `embedContent`/`batchEmbedContents` on
   `text-embedding-004`. No SDK upgrade needed (confirmed available in the
   currently installed `@google/generative-ai@0.24.1`).
4. **Wire up `DocumentChunk`** — currently a fully dead entity (registered in
   `app.module.ts`'s entities array and the `Document.chunks` relation, but no
   repository/service/read/write anywhere). New `DocumentChunksService` with raw
   `.query()` calls for insert (using the installed-but-unused `pgvector` npm
   package to format the embedding literal) and cosine-similarity search via the
   `<=>` operator, scoped by `userId` through a join to `Document`. Trigger
   chunk+embed as a fire-and-forget step in `ExtractionService.process()` after
   transactions save, with its own try/catch so an embedding failure never fails
   the whole document.
5. **Retrieval + generation** — new `backend/src/analytics/rag.service.ts`
   (deliberately separate from `AnalyticsService.financeChat`'s deterministic-intent
   path — see decision above): embeds the user's question, runs cosine search over
   that user's chunks (and optionally transaction descriptions, for the
   "semantic search across transactions" use case), builds a grounded prompt with
   citations, calls Gemini for the final answer.
6. **Response shape** — extend `FinanceChatResponse`
   (`frontend/src/api/analytics.ts`) with `sources?: {documentId, documentTitle,
   snippet}[]`; extend `DashboardPage.tsx`'s chat render loop (currently plain
   text) to show citations under grounded answers.

## Verification plan

- Confirm `DocumentChunk` rows populate with real (non-null) embeddings after a
  document is processed.
- Sanity-check a raw cosine-similarity SQL query directly returns topically
  relevant chunks for a test question.
- Ask a fine-print question through chat (e.g. "what does my statement say about
  late fees?") → confirm the answer cites the right document/snippet and doesn't
  state a number not present in the retrieved text.
- Confirm existing deterministic numeric intents (e.g. "how much did I spend this
  month?") still route to the old path, unaffected by this change.

## Critical files

`backend/src/entities/document-chunk.entity.ts`, `backend/src/entities/document.entity.ts`,
`backend/src/documents/gemini.service.ts`, `backend/src/documents/extraction.service.ts`,
`backend/src/documents/document-chunks.service.ts` (new),
`backend/src/documents/chunking.util.ts` (new),
`backend/src/analytics/rag.service.ts` (new), `backend/src/analytics/analytics.service.ts`,
`frontend/src/api/analytics.ts`, `frontend/src/pages/DashboardPage.tsx`.

## What was built

Matches the plan above, with these deviations/findings worth recording:

- **Embedding model: `gemini-embedding-001`, not `text-embedding-004`.** The plan's
  model had been deprecated/removed by the time this was built — a live API call
  returned `404 models/text-embedding-004 is not found`. `ModelService.ListModels`
  showed only `gemini-embedding-001`/`gemini-embedding-2(-preview)` support
  `embedContent` now. `gemini-embedding-001` defaults to **3072**-dimensional output
  (Matryoshka representation learning), which doesn't fit `DocumentChunk.embedding`'s
  `vector(768)` column — fixed by passing an explicit `outputDimensionality: 768` on
  every embed request. That field isn't in the installed
  `@google/generative-ai@0.24.1` SDK's `EmbedContentRequest` type (confirmed via a
  raw REST call that the API itself accepts it regardless), so `gemini.service.ts`
  intersects it in locally (`EmbedRequestWithDimensions`) rather than waiting on an
  SDK upgrade. If this SDK is ever upgraded, check whether the type now declares
  `outputDimensionality` natively and drop the intersection type if so.
- **The intent classifier needed a prompt fix to make the "fallback" decision
  actually fire.** `parseFinanceChatIntent()`'s `unknown` case was described as
  "chitchat, unsupported" — live-tested, a fine-print question like "What does my
  statement say about late payment fees?" got misclassified as a numeric intent
  (the deterministic path's "no transactions found" message) because it mentions a
  rupee amount. Fixed by rewording `unknown` in the prompt
  (`gemini.service.ts::parseFinanceChatIntent`) to explicitly say statement-text/
  fine-print/terms questions belong there even when they mention money, and not to
  force them into `compare_amount`/`sum_debits`/`investment_estimate`. Re-verified
  live after the fix — same question then correctly routed to RAG.
- **Numeric grounding is verified, not just prompted.** Per the financial-correctness
  invariant and this phase's own verification plan ("doesn't state a number not
  present in the retrieved text"), `RagService.verifyGroundedAnswer()` extracts every
  number from the model's answer and checks it appears in the retrieved excerpts —
  same pattern as `AnalyticsService.verifyAnomalies`, applied to free text instead of
  structured transactions. An answer that fails isn't dropped (unlike a structured
  field, mangling prose text isn't safe) — it gets a disclaimer appended instead.
- **Indexing is awaited inside `process()`, not a second fire-and-forget layer.**
  The plan called for firing chunk+embed off detached from the rest of extraction.
  `ExtractionService.process()` itself is already invoked fire-and-forget by
  `DocumentsService.upload()`, so a document's status/transactions are never blocked
  on indexing regardless of whether indexing is awaited one level further in —
  nesting a second detached async step would only have added test nondeterminism for
  no real latency benefit. `indexDocumentChunks()` still has its own try/catch (an
  embedding/DB failure never flips a document to FAILED), matching the planned
  reliability guarantee.
- **Vision-path (scanned/image) documents are never indexed.** No raw text is ever
  extracted on that path today, so `rawDocumentText` stays `null` and
  `indexDocumentChunks` is skipped — consistent with "don't guess," not a regression.
- Verified end-to-end against the real backend with live Gemini calls: a statement
  with fine-print fee clauses produced real 768-dim embeddings in `document_chunks`,
  a grounded chat question returned an accurate, correctly-cited answer with
  `sources`, a plain numeric question still routed through the unchanged
  deterministic path (no `sources` field), and the citation tag rendered correctly
  in the Dashboard chat UI in a real browser.
