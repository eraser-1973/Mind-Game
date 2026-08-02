# Stage 9: single-administrator authentication and immutable audit

## Scope

Stage 9 adds the security foundation for one administrator: an empty-by-default
administrator account table, password provisioning and rotation tooling,
database-backed login/session/rate-limit facts, CSRF-protected logout, immutable
security audit logs, a read-only audit API, and an isolated `/admin` React entry.

It does **not** add candidate configuration, participant/identity views, scoring
controls, exports, deletion, password-change pages, roles, registration, or a
second administrator. Quick and Formal participant flows retain their existing
cookies, APIs, persistence, candidate content, and scoring behavior.

## Migration 0011 and the single-account invariant

`migrations/0011_admin_auth_audit.sql` advances
`app_metadata.schema_version` to `9` and creates:

- `admin_auth_policies`: versioned authentication parameters;
- `admin_users`: the single administrator credential record;
- `admin_sessions`: hashed session/CSRF tokens and server-controlled expiry;
- `admin_login_attempts`: privacy-minimized limit facts;
- `admin_audit_logs`: immutable administrator security events.

`admin_users.singleton_id` is the primary key and is constrained to exactly
`1`, so SQLite cannot store a second row. There are no role or registration
tables. Migration 0011 inserts **no administrator username, password, salt, or
password hash**. After migration, the account table must remain empty until the
operator deliberately runs the interactive provisioning command.

Published authentication policies and audit rows have database triggers that
reject update/delete. Administrator and session identity fields are protected;
only the intended password-history and session-lifecycle fields can change.
There is a partial unique index allowing only one unrevoked session for the
single account.

The published policy `admin-auth-1.0.0` fixes:

| Parameter | Value |
| --- | ---: |
| Password KDF | PBKDF2-HMAC-SHA256 |
| Iterations | 600,000 |
| Random salt | 16 bytes |
| Derived key | 32 bytes |
| Session and CSRF token | 32 random bytes each |
| Absolute session lifetime | 28,800 seconds (8 hours) |
| Idle lifetime | 1,800 seconds (30 minutes) |
| `last_seen` write interval | 300 seconds (5 minutes) |
| Per username/fingerprint failures | 5 in 900 seconds |
| Global failures for a username | 30 in 3,600 seconds |

## Passwords, random tokens, and constant-time verification

PBKDF2-HMAC-SHA256 is available in both Cloudflare Web Crypto and Node's
standard crypto module. Its 600,000 iterations deliberately make an offline
password guess expensive. Every initial password and rotation gets a fresh
16-byte cryptographic salt and a 32-byte derived key. The salt and derived key
are Base64 in D1; the plaintext password is never persisted or logged.

Password records need a deliberately expensive PBKDF2 derivation because human
passwords have limited entropy. Session and CSRF values are already 32-byte
cryptographic random tokens, so D1 stores a direct SHA-256 hex digest of each
token instead. Raw tokens exist only in their respective browser cookies.
Password-derived bytes and token/CSRF hashes are compared through the project's
constant-time byte helper, preferring `crypto.subtle.timingSafeEqual` when the
runtime exposes it and otherwise using a fixed-loop XOR comparison.

An unknown username still performs the same 600,000-iteration dummy PBKDF2 and
gets the same `401 INVALID_ADMIN_CREDENTIALS` response as a wrong password or a
disabled account. This reduces username-enumeration timing and message leaks.

The production-parameter Miniflare/workerd integration test measured about
**910 ms** for one successful 600,000-iteration login in the 2026-08-02 local
verification run. The production iteration count was not reduced. This latency
must be rechecked on the deployed Worker before enabling the administrator, but
it is not a reason to silently weaken the policy.

## Interactive provisioning and rotation

Run migrations before provisioning. The commands are intentionally interactive:

```powershell
npm run admin:provision:local
npm run admin:provision:remote
```

The tool prompts for a username, then reads the password twice with terminal
echo disabled. Passwords are not accepted as command-line arguments, npm script
text, `.dev.vars`, or repository files. A mode-0600 SQL file containing only the
salt/hash record is briefly written under the operating-system temporary
directory and deleted in `finally`, including failure paths.

The first command creates the singleton record and an `admin_provisioned` audit.
A second creation is rejected. Password rotation is explicit:

```powershell
npm run admin:provision:local -- --rotate
npm run admin:provision:remote -- --rotate
```

Rotation requires the existing normalized username, derives a new salt/hash,
increments `password_version`, revokes every active administrator session with
`password_rotated`, and writes `admin_password_rotated` audit data. There is no
public bootstrap endpoint or web-based password change.

No remote administrator was created during Stage 9. After the remote migration
and table-count verification, the project owner must personally run
`npm run admin:provision:remote` in an interactive terminal before deployment.
Codex does not invent, receive, or store the production credential.

## Sessions, cookies, CSRF, and Origin

Successful login creates fresh 32-byte session and CSRF tokens. D1 stores only
their SHA-256 hashes and the server timestamps. A new login uses an optimistic,
bounded transition: it revokes the exact active-session snapshot with
`new_login`, writes that terminal audit, and creates the replacement only if no
other active session appeared. A contention retry prevents an unaudited stale
revocation while preserving the single-active-session invariant.

The response cookies are:

- `mg_admin`: `HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800`;
- `mg_admin_csrf`: `SameSite=Strict; Path=/; Max-Age=28800` and intentionally
  readable so the administrator client can send its value in
  `X-CSRF-Token`.

Both cookies add `Secure` for HTTPS and omit `Domain`. Local HTTP development
omits `Secure` so Wrangler localhost remains usable. `mg_admin` is never read by
JavaScript and neither token is written to `localStorage` or `sessionStorage`.

Every administrator write validates an exact same-origin `Origin` and requires
the CSRF cookie value to equal the `X-CSRF-Token` header and its SHA-256 digest
to equal the database value. Tokens in URLs, JSON bodies, or participant
cookies are ignored. If the readable CSRF cookie is missing or stale,
`GET /api/admin/session` rotates only CSRF state; it does not replace the
session token or extend the absolute expiry.

The server enforces both an eight-hour absolute expiry and a sliding 30-minute
idle expiry. Authenticated activity writes `last_seen_at` and the capped idle
expiry no more often than every five minutes. Absolute expiry is never extended.
Expired sessions are revoked and audited once in the same D1 batch. An audit
constraint failure therefore rolls back the matching revocation rather than
silently leaving an unaudited terminal state.

## Login limits and privacy-minimized fingerprinting

Before password verification, a read-only precheck avoids unnecessary PBKDF2
work for an already-blocked request. After invalid credentials are verified,
one conditional D1 insert atomically claims a remaining failure slot, and that
insert plus its mandatory failure audit run in one D1 batch. Concurrent requests
therefore cannot over-admit the last slot, and an audit failure rolls the attempt
back. A successful-attempt fact is likewise created in the session transition
batch. The request is blocked after five failures for the same normalized
username and client fingerprint in 15 minutes, or 30 failures for the same
normalized username across fingerprints in one hour. The response is
`429 ADMIN_LOGIN_RATE_LIMITED` with `Retry-After`. Limits use Worker server time
and D1, not browser time or in-memory counters.

The fingerprint module reduces IPv4 to `/24` or IPv6 to `/48`, combines that
prefix with a normalized User-Agent, and persists only a SHA-256 hash. It also
stores a separate User-Agent SHA-256 where a session needs it. Full IP,
truncated-prefix plaintext, and raw User-Agent are never persisted or returned.
The fingerprint is for limits/audit only and is never an authentication factor.

## Administrator APIs

| Method and path | Purpose |
| --- | --- |
| `POST /api/admin/login` | Strict same-origin JSON login, limits, session creation |
| `GET /api/admin/session` | Safe current-user/session projection and CSRF repair |
| `POST /api/admin/logout` | Same-origin CSRF-protected revocation and cookie clearing |
| `GET /api/admin/audit-logs` | Read-only fixed-order cursor pagination and safe filters |

All administrator API envelopes contain a `requestId` and use `Cache-Control:
no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer`. They never set wildcard CORS. Unknown admin API
paths return JSON 404 instead of the React shell. Route errors are sanitized;
no stack, SQL, database ID, filesystem path, password, cookie, token, hash, or
participant identity is returned.

Logout checks the exact same-origin `Origin` before authentication or cookie
mutation. It is safely replayable after that boundary: an active authenticated
call needs valid CSRF, revokes and writes its terminal audit in one D1 batch,
then clears both cookies; a replay using the revoked cookie still clears both
cookies and returns safe success without duplicating the terminal audit.

## Immutable audit data

Audit rows contain an audit UUID, optional administrator/session references,
an allowlisted action and outcome, optional target identifiers, request ID,
optional hashed client fingerprint, safe JSON metadata, and server time.
Metadata is projected through an allowlist. Audit inserts are strict: duplicate
or invalid non-terminal audit IDs surface as failures instead of being hidden
by `INSERT OR IGNORE`. Terminal session events use a narrowly scoped conflict
rule only for the same session/action replay. Metadata cannot contain passwords,
cookies, raw/hash tokens, CSRF values, full IP, raw User-Agent, or participant
identity. SQLite triggers reject every update and delete, and the Worker exposes
GET only. Viewing logs writes one `admin_audit_logs_viewed` event after the
fixed-order query, so it does not recursively appear in the page being read.

## `/admin` application and participant isolation

`src/RootApp.tsx` mounts `AdminApp` only for `/admin` and `/admin/*`; every other
path mounts the existing participant `App`. The administrator app checks
`GET /api/admin/session`, shows a username/password login when unauthenticated,
and otherwise shows only the current username, absolute expiry, the read-only
recent audit list, pagination, and secure logout. It does not mount participant
resume/session creation, read participant browser persistence, or show identity,
ratings, questionnaires, metrics, exports, deletion, or configuration controls.

Administrator HTML receives `Cache-Control: no-store`, frame denial, MIME
sniffing/referrer/permissions restrictions, and this CSP:

```text
default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:;
style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
form-action 'self'
```

`style-src 'self'` is sufficient because Vite serves the compiled stylesheet
from the same origin. No `unsafe-eval`, inline style permission, or external
script origin is required. `wrangler.jsonc` lists `/admin` and `/admin/*` in
`assets.run_worker_first`; without those patterns, Cloudflare's asset layer
would serve the SPA shell before the Worker could attach these headers. A
configuration test and a real local Wrangler smoke test cover this boundary.

## Verification and cleanup

Local migration and quality gates:

```powershell
npm run db:migrations:list:local
npm run db:migrate:local
npm run db:migrations:list:local
npm run test:worker
npm test -- --run
npm run typecheck
npm run build
npm run check
git diff --check
```

Final verification on 2026-08-02 produced these results:

- Worker: 36 test files and 345 tests passed;
- frontend: 31 test files and 156 tests passed;
- TypeScript project check passed;
- Vite 6.4.3 production build passed and wrote `dist`;
- the aggregate `npm run check` command passed;
- a real local Wrangler smoke returned health `200`, administrator document
  `200` with the documented security headers, and unauthenticated administrator
  session `401`;
- an independent security review reported no remaining Critical or Important
  findings after the concurrent-rate-limit and atomic-audit regressions were
  covered.

Both local and remote D1 reported no pending migration, schema version `9`, the
published 600,000-iteration policy, and zero rows in all four administrator
business tables. Remote participant, identity, session, game-run, and scoring-run
tables also remained at zero. No deployment or remote provisioning was run.

`npm audit --omit=dev` still reports the pre-existing high-severity PostCSS
advisory GHSA-r28c-9q8g-f849. Stage 9 intentionally does not change this
unrelated dependency; it remains a deployment follow-up risk.

The canonical local database is kept credential-free. Synthetic provisioning,
rotation, login, limits, expiry, CSRF, audit, and cleanup are exercised in
isolated Miniflare/temp-file tests. If an operator creates a manual local test
account, remove dependent test facts first and the immutable test audit data by
discarding/recreating only the **local Wrangler D1 state**, then reapply the
migrations; never run that cleanup against remote D1. Confirm afterward that
`admin_users`, `admin_sessions`, `admin_login_attempts`, and
`admin_audit_logs` are all zero while the policy and schema remain.

Only after all local gates pass, apply the remote schema:

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

Then query `schema_version`, the published policy, and all four administrator
business-table counts. Do not run `admin:provision:remote` during migration
verification, and do not deploy as part of Stage 9.

## Deployment preparation and deferred stages

Before a later authorized deployment, the owner must (1) confirm remote schema
version 9 and zero unexpected administrator data, (2) interactively provision
the one production administrator, (3) retain the credential outside Git and
Cloudflare configuration, (4) test login/logout and the measured PBKDF2 latency
in the target Worker, and (5) review audit creation without exposing secrets.

Stage 10 will add candidate-configuration draft validation and versioned
publication behind this authorization boundary. Stage 11 will add protected
export. Stage 12 will add permanent deletion and the deletion manifest. None of
those capabilities is present in Stage 9.
