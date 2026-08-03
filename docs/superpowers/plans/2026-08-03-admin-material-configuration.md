# Stage 10A: Versioned material configuration implementation plan

> Branch: `feature/cloudflare-d1-backend`
> Starting commit: `9624c6ce9bd54b6771485ab79fc66cc3c4969c8e`

## Scope and invariants

This stage adds administrator-managed, versioned public candidate material, evidence metadata, point rules, sunk-cost rules, and configuration-set publication/activation. It deliberately excludes benchmark editing, norm/reliability/scoring-definition editing, participant exports/deletion, and deployment.

The following invariants must hold throughout implementation:

- published component content is immutable; changes require a new draft version;
- publishing and activating a configuration set are separate operations;
- at most one configuration set is active, and existing sessions retain their pinned versions;
- formal participants receive only public candidate material from their pinned server material version;
- evidence is disclosed only by the existing unlock API;
- Quick mode continues to use the existing local candidate data and never calls the formal materials endpoint;
- every administrator write is authenticated, same-origin, CSRF protected, JSON-only, UUID-idempotent, revision checked where applicable, audited, and free of participant identity or secrets.

## Task 1: Define migration contract with failing tests

**Files**

- Create: `migrations/0012_admin_material_configuration.sql`
- Create: `worker-tests/materialConfigurationMigration.test.ts`

**Steps**

1. Add tests that apply migrations through 0012 and assert schema version 10, required tables/columns/indexes/triggers, 5 current profiles, 20 current evidence rows, published metadata backfill, one active configuration, and preservation of Stage 1–9 data.
2. Add tests proving published profiles, evidence, point rules, sunk-cost rules, validation runs, activation history, and receipts cannot be mutated or deleted.
3. Add tests comparing the migrated public material with the exact public fields from `src/data/candidates.ts`, while asserting hidden fields are absent.
4. Implement 0012 as a forward-only migration. Add `material_sets`, `candidate_material_profiles`, validation/history/receipt tables; extend existing component/config tables without rewriting migrations 0001–0011; add constraints, indexes, immutable triggers, backfills, canonical initial fingerprints, and schema-version update.
5. Run the migration test file, then the full Worker suite.

## Task 2: Add configuration domain validation and fingerprints with failing tests

**Files**

- Create: `worker/domain/configuration.ts`
- Create: `worker/domain/configurationFingerprint.ts`
- Create: `worker/validation/adminConfigurationRequest.ts`
- Create: `worker-tests/configurationDomain.test.ts`

**Steps**

1. Test stable canonical JSON and SHA-256 fingerprints, version IDs, complete material documents, hidden-field rejection, point rules, sunk-cost rules, and cross-component configuration validation.
2. Implement stable recursive object-key sorting and deterministic profile/evidence ordering.
3. Implement field-path/code validation issues and warnings (`BENCHMARK_PROVISIONAL`, `NORMS_UNAVAILABLE`) without SQL or stack details.
4. Validate exactly A–E, exactly 5 profiles and 20 evidence items, per-level order, experience structure, polarity/key-risk values, no hidden public fields, and rule constraints.

## Task 3: Add repository/service transactions and administrator APIs with failing tests

**Files**

- Create: `worker/services/adminConfiguration.ts`
- Create: `worker/routes/adminConfiguration.ts`
- Modify: `worker/routes/admin.ts`
- Modify: `worker/services/adminAudit.ts`
- Create: `worker-tests/adminMaterialConfigurationApi.test.ts`
- Create: `worker-tests/adminRuleConfigurationApi.test.ts`
- Create: `worker-tests/adminConfigurationSetApi.test.ts`

**Steps**

1. Test authentication on all reads and authentication/origin/CSRF/JSON/body-size/idempotency on all writes.
2. Implement an idempotent command wrapper using UUID `Idempotency-Key`, canonical request SHA-256, replayed response bodies, and 409 on key/body mismatch.
3. Implement list/detail/clone/update/validate/publish for material, point, sunk-cost, and configuration sets.
4. Use D1 batch operations so a full material document, revision increment, receipt, and audit succeed or fail together.
5. Enforce current revision/fingerprint validation before publish; reject published updates; keep publish separate from activation.
6. Implement atomic activation and rollback activation with exactly one active configuration plus append-only activation history and audit.
7. Extend the audit action union and metadata allowlist only with approved configuration fields.
8. Return stable JSON envelopes and sanitized errors with request IDs.

## Task 4: Add participant materials API with failing tests

**Files**

- Create: `worker/routes/formalMaterials.ts`
- Modify: `worker/router.ts`
- Create: `worker-tests/formalMaterialsApi.test.ts`

**Steps**

1. Test `mg_session` authentication, URL/cookie session match, pinned `sessions.material_version`, display order, `Cache-Control: no-store`, read-only behavior, and `MATERIAL_NOT_READY`.
2. Assert the response excludes evidence, polarity, key-risk metadata, and every hidden answer field.
3. Test that activation changes only new sessions; old sessions keep old material, point, and sunk-cost versions.
4. Implement `GET /api/sessions/:sessionId/materials` without consulting the current active configuration.

## Task 5: Replace formal local candidate reads with server public material

**Files**

- Create: `src/api/formalMaterials.ts`
- Create: `src/api/formalMaterials.test.ts`
- Modify: `src/types/game.ts`
- Modify: `src/components/CandidateList.tsx`
- Modify: `src/components/FormalCandidateDetail.tsx`
- Modify: `src/components/FormalGameScreen.tsx`
- Modify: `src/App.tsx`
- Update formal component tests as needed

**Steps**

1. Add frontend tests showing Formal fetches server profiles on entry and resume, uses server fields, retains data in React memory only, shows an explicit retry state, never falls back to `candidates.ts`, and never exposes hidden fields.
2. Define a public candidate view type separate from the full Quick `Candidate` type.
3. Add the no-store API client and App-level in-memory loading/error/retry state.
4. Pass server profiles into formal game components and remove formal imports of `candidateById`.
5. Keep Quick `GameScreen`, report, local candidate content, and evidence flow unchanged.

## Task 6: Add administrator configuration UI with failing tests

**Files**

- Modify: `src/admin/adminApi.ts`
- Modify: `src/admin/adminTypes.ts`
- Modify: `src/admin/AdminApp.tsx`
- Modify: `src/admin/AdminDashboard.tsx`
- Create: `src/admin/AdminConfigurationConsole.tsx`
- Create: `src/admin/AdminMaterialEditor.tsx`
- Create: `src/admin/AdminRuleEditors.tsx`
- Create: `src/admin/AdminConfigurationSetEditor.tsx`
- Modify: `src/styles/game.css`
- Create/update administrator frontend tests

**Steps**

1. Test authenticated navigation, active configuration display, version lists, clone/edit/read-only states, revision conflict handling, validation errors/warnings, publish confirmation, activation confirmation by typed ID, rollback activation, and explicit exclusions.
2. Reuse the existing CSRF client and add idempotency keys per write action.
3. Keep configuration documents in component memory only; do not write localStorage/sessionStorage.
4. Implement responsive neutral editing screens with no participant data, benchmark scoring editor, norm/reliability editor, export, or delete actions.

## Task 7: Verify local behavior and clean synthetic data

**Steps**

1. Run `npm run db:migrate:local` and query schema version, row counts, table/index/trigger presence, and one-active invariant.
2. Start a local Worker on a dedicated port, provision a local administrator, and exercise material/rule/config clone, edit, stale revision, validation, publish, activation, rollback, pinned old/new sessions, and formal frontend failure/retry behavior.
3. Query audit, validation, activation, and receipt records.
4. Restore `config-2026-07-v1` as active and delete only synthetic local participants, sessions, drafts/published test versions, administrator sessions/attempts/audits, and the local test administrator.
5. Confirm participant/admin business tables are empty and initial published configuration remains intact.
6. Run `npm test -- --run`, `npm run test:worker`, `npm run typecheck`, `npm run build`, and `npm run check`.

## Task 8: Apply the remote schema migration only after every local gate passes

**Steps**

1. List pending remote migrations and verify only 0012 is pending.
2. Apply `0012_admin_material_configuration.sql` remotely.
3. Execute read-only remote checks for schema version, required tables, initial counts/fingerprints, and active configuration.
4. Confirm no remote test administrator, participant, session, draft/test version, or audit data was created.
5. Do not run `wrangler deploy`.

## Task 9: Document, review, verify, and commit once

**Files**

- Create: `docs/backend-stage-10a-material-configuration.md`

**Steps**

1. Document schema, APIs, version lifecycle, fingerprints, idempotency, audit, formal/Quick separation, local verification, remote migration result, rollback procedure, and Stage 10B exclusions.
2. Review the diff for hidden fields, identity data, tokens, cookies, secrets, and accidental deployment changes.
3. Run all required checks again and inspect `git diff --check` and `git status --short`.
4. Create exactly one commit: `feat: add versioned material configuration management`.
5. Do not push, open a PR, merge, switch branches, or start Stage 10B.
