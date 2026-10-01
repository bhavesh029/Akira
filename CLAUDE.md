# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

For the full architecture mind map, entity graph, and AI extraction workflow diagram, **read [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) first** — this file covers day-to-day commands and conventions instead of repeating that content.

## Active Build Plan

This project is mid-build on a phased MVP plan. **Before doing implementation work, read [`docs/phases/README.md`](./docs/phases/README.md)** for current phase status, and **[`.agents/rules/build_workflow.md`](./.agents/rules/build_workflow.md)** for the specific rules governing how phases get built (financial-correctness invariants, tooling discipline, verification bar, and — importantly — which phase is currently blocked and must not be started).

## Project Summary

Akira (IEOP) is a two-package monorepo: a NestJS + TypeORM backend and a React 19 + Vite frontend, backed by Supabase PostgreSQL (with `pgvector`) and Supabase Storage. Its core function is AI-driven bank statement processing: users upload PDF/image statements, the backend extracts transactions (via deterministic per-bank parsers or Gemini as a fallback), and the frontend shows analytics, AI-generated insights, and a finance chat assistant over that data.

No repo-root `package.json` — `backend/` and `frontend/` are independent npm projects, run and linted separately.

## Commands

### Backend (`cd backend`)
```bash
npm install --legacy-peer-deps   # required flag — see peer dep note below
npm run start:dev                # dev server w/ watch, http://localhost:3000
npm run build                    # nest build
npm run lint                     # eslint --fix, UNSCOPED (whole src/ tree) — see warning below
npm test                         # jest unit tests
npm run test:e2e                 # jest e2e tests (test/jest-e2e.json)
npm run test:cov                 # coverage
npm run migration:generate       # -- <path/Name>, diffs entities against a live DB
npm run migration:run            # applies pending migrations
npm run migration:revert         # reverts the last migration
```
Run a single test file: `npx jest src/analytics/analytics.service.spec.ts`.

**⚠️ Do not run `npm run lint` (or any bare `eslint --fix`) unscoped.** The codebase does not currently conform to its own prettier config, so an unscoped `--fix` reformats dozens of unrelated files into a huge diff — this happened once already mid-build. Check with `npx eslint <files you touched>` (no `--fix`); fix scoped with `npx eslint <file> --fix` only on files you're already editing.

### Frontend (`cd frontend`)
```bash
npm install
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build
npm run lint      # eslint .
npm run preview   # preview production build
```

### Local database (optional, alternative to hosted Supabase)
```bash
docker-compose up -d   # pgvector/pgvector:pg16 on localhost:5432 (akira_local)
```

## Environment Variables

Backend validates required vars at startup and **exits with a clear error if any are missing** — check `backend/.env.example` before debugging a boot failure:
- `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `CORS_ORIGINS`, `PORT`, `JWT_EXPIRATION`, `SUPABASE_STORAGE_BUCKET`

Frontend: `VITE_API_URL` (defaults to `http://localhost:3000`), see `frontend/.env.example`.

## Architecture Notes

- **Auth**: JWT via Passport (`src/auth/jwt.strategy.ts`). Every resource controller other than `auth` is `@UseGuards(AuthGuard('jwt'))` and scopes queries to `req.user.id` — when adding an endpoint, follow this pattern rather than trusting a body/query `userId`.
- **Documents pipeline** (`backend/src/documents/`): `extraction.service.ts` orchestrates download → optional password decryption → text extraction (`pdf-parse`) → bank-specific parsing via `parsers/parser.factory.ts` → Gemini fallback (`gemini.service.ts`) → save transactions → update `DocumentStatus`. When adding support for a new bank, add a `BankParser` implementation under `parsers/` and register it in `parser.factory.ts`; don't special-case it elsewhere.
- **Analytics module** has three concerns living together: SQL aggregation (`getSummary`), Gemini-backed insights with an in-memory TTL cache (`ai-insights-cache.service.ts` — invalidate it when transactions change for a user), and the `/analytics/chat` natural-language endpoint (`finance-chat.types.ts`/`finance-chat.dto.ts`) that has Gemini parse intent+filters, then answers from SQL data rather than letting the LLM invent numbers.
- **Database**: TypeORM `synchronize` is enabled only when `NODE_ENV !== 'production'` (see `app.module.ts`). A real migration system exists now (`backend/src/data-source.ts`, `backend/src/migrations/`) — any schema change ships as a migration (`npm run migration:generate -- src/migrations/Name`), not just an entity edit. Deletes cascade (`User` → `Account`/`Document`/`Transaction`) to keep DPDP "right to erasure" compliance simple — preserve `onDelete: 'CASCADE'` semantics when touching entities.
- **Money columns**: any decimal/money column must use the `DecimalTransformer` (`backend/src/entities/transformers/decimal.transformer.ts`) — without it, Postgres `decimal` columns come back as strings, not numbers.
- **Frontend**: no state library beyond React Context (`AuthContext`) — API calls go through `src/api/*.ts` wrappers around a single shared Axios client (`src/api/client.ts`). Pages are route-level components under `src/pages/`; there's no shared component library beyond `Layout`, so new UI is generally built inline in the page it belongs to.

## Conventions & Gotchas

- Backend peer deps require `--legacy-peer-deps` on install — plain `npm install` may fail.
- `backend/.env` and `frontend/.env*` are gitignored; never commit real Supabase/Gemini credentials. `backend/statement.pdf` in the working tree is local test fixture data, not something to reference in code.
- Check lint on whichever package you touched with a **scoped, non-mutating** `npx eslint <files>` before considering a change done — see the lint warning above. Both packages use ESLint 9 flat config.
- The `.agents/rules/auto_read_context.md` rule (for other agent tooling) also points at `PROJECT_CONTEXT.md` — keep both docs in sync if the architecture changes (new modules, new bank parsers, schema changes). `.agents/rules/build_workflow.md` holds the phased-build rules — keep it in sync with `docs/phases/` as phases complete.
