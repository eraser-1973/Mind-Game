# Temporary public administrator mode

## Scope

Add an explicit `ADMIN_AUTH_MODE` switch with `password` (the default) and
`public` modes. Production will explicitly set `public` for this temporary
release. No database migration, participant-flow change, or change to existing
password records is part of this work.

## Authentication behaviour

- `password`: retain the existing username/password, `mg_admin` cookie, login
  attempt, session, CSRF, Origin, audit and logout behaviour.
- `public`: resolve the singleton administrator (`singleton_id = 1`) only for
  the audit identity; accept no password and create no `admin_sessions` or
  `admin_login_attempts` rows. Missing singleton data returns
  `ADMIN_PUBLIC_MODE_NOT_READY` (503).
- Unset `ADMIN_AUTH_MODE` defaults to `password`; invalid values return a
  safe configuration error and do not fall back to public access.

## Public-mode request protection

`GET /api/admin/session` creates only a random, browser-readable double-submit
CSRF cookie (Secure, SameSite=Strict, Path=/api/admin) and returns
`authenticated: true`, `authMode: "public"`, and `username: "public-admin"`.
It creates no database session. All write endpoints retain same-Origin, JSON,
request-size, idempotency, parameter binding, confirmation, HMAC tombstone,
audit, and `no-store` protections. CSRF values are neither stored in D1 nor
written to audit data. Password login returns 410 in public mode; logout only
clears the CSRF cookie and is idempotent.

## Frontend

The administrator app first reads the session endpoint. A public session opens
the existing console without calling password login and shows a persistent,
prominent warning that anyone with the URL can view, export, or delete research
data, plus `PUBLIC ADMIN MODE`. Password mode preserves the login screen.

## Audit and recovery

Public-mode operations retain the singleton administrator ID and record only
`authMode: "public"` as additional safe metadata. Cookies, CSRF tokens,
password material, and request payloads are not recorded. To restore password
mode, set `ADMIN_AUTH_MODE = "password"` in `wrangler.jsonc`, deploy, and use
the existing administrator account; no database action is required.

## Verification

Tests cover both modes, public identity/session behaviour, missing singleton,
login disabling, CSRF and Origin enforcement, idempotency, safe audit metadata,
password regression, and administrator UI states. The release runs the
administrator-related Worker tests, frontend tests, typecheck, build, and
`git diff --check` before deployment.
