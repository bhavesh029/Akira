# Phase 3 — RAG (Grounded Chat + Semantic Search + Fine-Print Q&A)

**Status:** ⬜ Not started.
**Depends on:** Phase 1 (reviewed-transaction gate; RAG answers should respect it
where they touch transaction data).

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
`backend/src/analytics/rag.service.ts` (new), `backend/src/analytics/analytics.service.ts`,
`frontend/src/api/analytics.ts`, `frontend/src/pages/DashboardPage.tsx`.
