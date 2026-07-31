# Backend Stage 1: Worker and D1 foundation

## Scope

Stage 1 adds the deployment and persistence foundation only. It does not connect the existing formal or quick game flows to an API, and it does not create identity, participant, session, rating, evidence, questionnaire, administrator, configuration, scoring, export, or deletion tables.

The existing React/Vite application remains unchanged.

## Runtime architecture

One Cloudflare Worker serves both the static SPA and the same-origin API:

```text
Browser request
  |-- /api/*  -> worker/index.ts -> worker/router.ts
  |               |-- GET /api/health -> D1 app_metadata query
  |               `-- otherwise       -> JSON 404
  `-- other   -> env.ASSETS.fetch(request) -> dist asset or SPA fallback
```

The Worker entry is `worker/index.ts`. API responses use the common helpers in `worker/http/responses.ts`. They always set `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`. API errors expose a request ID and a public message, not an internal stack, database identifier, token, local path, or environment value.

The application intentionally does not set `Access-Control-Allow-Origin: *`; the frontend and API are same-origin.

## Cloudflare bindings

`wrangler.jsonc` defines:

- `ASSETS`: static files built into `dist`, with `single-page-application` fallback.
- `DB`: D1 database `mind-game-production`, ID `6670f515-5f55-4f9a-aded-d4cf2092fabb`.

`run_worker_first: ["/api/*"]` prevents API routes from being swallowed by the SPA fallback. The compatibility date remains `2026-07-01`.

## Initial migration

`migrations/0001_infrastructure.sql` creates only `app_metadata` and seeds:

- `schema_version = 1`
- `service_name = mind-game-api`

Metadata timestamps are stored as UTC ISO 8601 strings. Wrangler manages its own `d1_migrations` table; project SQL must not create or modify that system table.

### Apply and inspect locally

```powershell
npm run db:migrations:list:local
npm run db:migrate:local
npm run db:migrations:list:local
npx wrangler d1 execute mind-game-production --local --command "SELECT key, value, updated_at FROM app_metadata ORDER BY key;"
```

Local D1 files are stored under `.wrangler/state/` and are ignored by Git.

### Apply and inspect remotely

Run this only after local tests pass and after confirming the database contains no production data that needs protection:

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
npx wrangler d1 execute mind-game-production --remote --command "SELECT key, value, updated_at FROM app_metadata ORDER BY key;"
```

The Stage 1 migration was applied to the remote database on 2026-07-31. Re-running the list commands should report that there are no migrations to apply.

## Local development

The original Vite-only workflow is unchanged:

```powershell
npm run dev
```

To build the frontend and run the complete local Worker with API, assets, SPA fallback, and local D1:

```powershell
npm run db:migrate:local
npm run dev:worker
```

Then verify:

```powershell
curl.exe -i http://127.0.0.1:8787/api/health
curl.exe -i http://127.0.0.1:8787/api/not-found
curl.exe -i http://127.0.0.1:8787/
curl.exe -i http://127.0.0.1:8787/a-front-end-route
```

Expected results are `200` JSON for health, `404` JSON for the unknown API, and `200` HTML for both the root and SPA route.

## Tests and checks

```powershell
npm test -- --run
npm run test:worker
npm run typecheck
npm run build
npm run check
```

Worker tests use Vitest 3.2.7 with Miniflare 4.20260730.0 and the official workerd 2026-07-30 runtime against an isolated D1 database. This directly exercises the bundled Worker and D1 simulator while keeping the existing frontend Vitest configuration unchanged. The separate harness also avoids a Windows limitation observed in the compatible Cloudflare Vitest pool adapter when a repository path contains non-ByteString characters such as Chinese text.

## Secret and generated-file rules

Never commit:

- `.dev.vars` or `.dev.vars.*`
- Cloudflare API tokens or OAuth credentials
- administrator passwords, password hashes, or cookie secrets
- local D1 files under `.wrangler/state/`
- personal or test identity data
- `node_modules` or `dist`

The D1 database ID is a non-secret resource identifier and is intentionally stored in `wrangler.jsonc`.

## Rollback

Stage 1 has no business data. To roll back the code, revert the single Stage 1 Git commit on this feature branch. Do not delete the remote D1 database as part of an automatic rollback. D1 schema rollback must be performed with a new forward migration after reviewing any data that may have been added by later stages.

Local generated state can be discarded independently because `.wrangler/state/` is not committed.

## Deferred to Stage 2 and later

The following are deliberately not implemented yet:

- identity registration and separation of identity/research data
- participants and formal assessment sessions
- server-authoritative points, evidence, ratings, stage transitions, and timers
- questionnaires, final submissions, and derived research metrics
- session recovery, idempotent event APIs, and rate limiting
- administrator authentication, configuration publishing, CSV ZIP export, audit logs, and permanent deletion
- removal of confidential benchmark fields from the formal frontend bundle

No Stage 2 work should begin until Stage 1 is reviewed and explicitly approved.
