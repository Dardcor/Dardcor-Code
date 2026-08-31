# Security Policy

Security policy for the Dardcor Code local AI routing gateway and dashboard. This document covers the current state of the project (version 0.5.50). Claims here are backed by `docs/AUDIT.md` (the governing audit for this tree) and by the current source where follow-up fixes landed after that audit.

## Supported version

| Version | Supported |
| --- | --- |
| 0.5.50 (current, root and `cli/` packages) | Yes |
| Earlier versions | No |

## Reporting a vulnerability

Report through the private reporting mechanism of the repository or distribution you obtained this build from. This project is a private fork; if the place you got it offers GitHub private vulnerability reporting, use that. Otherwise, contact your operator privately, or report privately to whoever maintains your distribution.

The upstream project's tracker is only for issues that reproduce on unmodified upstream software — see the provenance record in [docs/UPSTREAM.md](docs/UPSTREAM.md) for the source identity. Do not report vulnerabilities that are specific to this modified fork there, because upstream does not own this fork's changes.

There is no dedicated security contact email for this project, so do not expect one. If you must share details publicly before a fix, keep exploit specifics out of the initial report. This project has no published response-time commitment; treat any reported timeline as best effort.

## Threat model

This is a local-first proxy. The gateway exposes one OpenAI-compatible endpoint (`/v1/*`) and a dashboard, both served on `http://localhost:21128` in the default posture. Its job is to translate requests and route them to 40+ upstream providers, holding provider credentials, OAuth sessions, and API keys on the local machine.

What we protect:

- Stored secrets: upstream API keys, OAuth tokens, the dashboard JWT signing secret, the machine-ID salt, and generated API-key HMAC secrets.
- The `$DATA_DIR` SQLite database that holds providers, combos, keys, and settings.
- The boundary between the local network and your provider accounts. Anyone who can reach the gateway port can consume your provider quota, and in the default configuration only loopback is trusted.

What we do not protect against by design:

- A remote attacker who already has code execution on the host. This is a local tool, not a sandbox.
- Malicious upstream providers. Routing your traffic to a provider means that provider sees your prompts and can fail in arbitrary ways.
- Traffic interception on the host itself, which is inherent to the retained MITM feature (below).

## Security defaults already implemented

The audit fixes of 2026-08-08 and 2026-08-09 are in place in this tree:

- **Generated, persisted 0600 secrets.** `JWT_SECRET`, `API_KEY_SECRET`, and `MACHINE_ID_SALT` default to 32-byte random values generated on first boot and persisted to `$DATA_DIR/jwt-secret`, `$DATA_DIR/api-key-secret`, and `$DATA_DIR/machine-id-salt`, all mode 0600. A strong user-supplied value is honored; known weak values are rejected at startup (`secret-policy.cjs`), before the listener binds.
- **`REQUIRE_API_KEY` defaults on.** Fresh installs require a valid API key on `/v1/*` and `/v1beta/*`, including the model catalogs. `true` forces enforcement on, `false` explicitly opts out, and any other value falls back to the persisted setting. This closed the previously public model catalog.
- **No default password.** The shared `123456` fallback was removed. With no saved hash, every bootstrap path is local-only: an explicit `INITIAL_PASSWORD` is bcrypt-persisted on first successful local login, or the dashboard presents a localhost-only create-password form with an 8-character minimum. Remote no-hash requests return 403. Password reset clears the hash back to setup-required.
- **Localhost-only setup posture.** First-run password creation and `INITIAL_PASSWORD` bootstrap both require loopback access.
- **Hardcoded-JWT flaw fixed.** CVE-2026-49352 (hardcoded default JWT secret) is fixed in 0.5.50; the signing secret now resolves through the generated-secret mechanism above.
- **Forwarded-header spoofing blocked.** `custom-server.js` derives the client IP from the TCP socket and strips attacker-controlled `X-Forwarded-For`, trusting forwarding headers only from a loopback reverse proxy.

Follow-up fixes landed after the audit and are reflected here:

- **Lockfile retained.** `package-lock.json` is now intentionally kept in the tree, so reproducible installs are possible from the root package.
- **Health endpoint emits no wildcard CORS.** `GET /api/health` returns `{ok:true}` with no `Access-Control-Allow-Origin` header; `OPTIONS` returns 204.
- **CLI token re-auth uses canonical validation.** The settings database export/import routes check `hasValidCliToken` from `dashboardGuard` instead of treating any non-empty `x-9r-cli-token` as a bypass, alongside the dashboard password check.
- **OIDC test probing always requires a dashboard session.** `/api/auth/oidc/test` calls `verifyDashboardAuthToken` regardless of `requireLogin`, and draft credentials supplied in the request body never mix with stored client secrets.
- **Dashboard JWTs carry a persisted `sessionVersion`.** The version is stored in settings, bumped monotonically on password writes and on DB imports, embedded in every issued token, and checked during verification; a DB error during verification fails closed (invalidates the session).

## Retained high-risk features, accepted by the owner

The following capabilities carry real security exposure and are intentionally preserved for this phase. They are inventory-only per the audit; they are not removed, disabled, or planned for removal unless the owner reverses that decision. Using any of them means accepting its risk:

- **MITM proxy (`src/mitm/`).** Terminates TLS via a generated local root CA to intercept IDE traffic. It can read plaintext prompts and responses between your tools and the gateway.
- **Subscription OAuth session extraction, import, and proxying.** OAuth tokens are extracted from CLI/IDE login sessions and proxied or refreshed (`/api/oauth/*/start-proxy`, Kiro CLI proxy import). Imported credentials are stored locally.
- **Codex bulk import.** Accepts one or more Codex OAuth account objects including access tokens.
- **Cursor/Kiro auto-import.** Reads IDE config files and imports stored credentials automatically.
- **Claude CLI spoof headers.** `CLAUDE_CLI_SPOOF_HEADERS` impersonates the Claude CLI client identity to upstream quota/auth endpoints.
- **Quota auto-ping.** `quotaAutoPing` generates background synthetic quota-check traffic against provider endpoints.
- **API-key and local providers.** Standard OpenAI-compatible API-key providers and self-hosted endpoints are preserved as-is.
- **Standard OAuth2 + PKCE.** Non-proxy OAuth flows remain part of the surface.

## Cursor wire capture (opt-in, local)

`src/mitm/` can capture the byte-transparent Cursor AgentService relay so one
sanitized manual turn can verify request, response, terminal, and tool frames
before real model routing is enabled. It is a separate, privacy-bounded path
from the general request dumps and is completely inactive unless
`MITM_CURSOR_CAPTURE=1` is set:

- **Metadata-only by default.** Writes timestamp, method, pathname (query
  stripped), byte counts, truncation flags, response status, error message, and
  response header/trailer NAMES. No request headers, auth tokens, cookies,
  checksums, or body text are ever written.
- **Raw bytes need explicit second consent.** Raw protobuf request/response
  bytes are stored only when `MITM_CURSOR_CAPTURE_FULL=1` is also set. Raw
  bytes may contain prompts, code context, tool data, and results — use a
  sanitized prompt for the test turn, disable the capture immediately
  afterward, and delete captures under `$DATA_DIR/logs/mitm/cursor-capture/`
  after analysis.
- **Local and restrictive.** Files live under
  `$DATA_DIR/logs/mitm/cursor-capture/` with directory mode 0700 and file mode
  0600, capped at 4 MiB request / 16 MiB response per stream. Capture errors
  fail open and never affect relay flow or backpressure. `clearDumpDir()`
  removes this subdirectory on every MITM start.

## Operator guidance

Safe deployment requires at least the following:

- Set a strong `INITIAL_PASSWORD` and complete the first login over localhost, or create the dashboard password through the localhost-only form. Never skip this on a shared machine.
- Leave `REQUIRE_API_KEY` on `true` unless you have a specific reason to expose the API anonymously.
- Do not set `JWT_SECRET`, `API_KEY_SECRET`, or `MACHINE_ID_SALT` unless you have strong random values ready. Unset, they generate and persist their own 0600 secrets. Never copy placeholder values from documentation, including the gitbook and i18n examples, which still carry weak literals and are rejected at boot.
- Back up `$DATA_DIR`. The secrets and the SQLite database live there; losing the directory loses both your config and the secrets needed to validate your API keys and sessions.
- Keep the service bound to localhost unless you are deliberately exposing it. The Docker default is `HOSTNAME=0.0.0.0`, which widens the attack surface to the network; put the gateway behind an authenticated reverse proxy and set `AUTH_COOKIE_SECURE=true` when serving over HTTPS.
- Treat the retained MITM, OAuth-import, spoofing, and quota-ping features as sensitive. Do not enable the MITM root CA or auto-import on machines you do not fully control.
- Update only to supported versions. The root `package-lock.json` is retained, so installs from this tree are reproducible; the `cli/` package is published separately and is not covered by that lockfile.

## Known limitations

- The test suite is not all green on a plain checkout (catalogued failures plus tests that require the absent `cloud/` worker directory or live provider credentials). The audit does not claim a green suite. The focused security suite does pass, but that is not a claim that the full suite is green.
- A clean install reports moderate npm-audit findings in `monaco-editor` and transitively `dompurify`. This is not a claim that npm audit is clean.
- The `cli/` npm package performs runtime/native downloads after install (`sql.js`, `better-sqlite3`, the `systray2` tray binary), so the published tarball is not self-contained and fetches from the network at install or first run.
- Five additional GHSA advisories were raised during review and remain unverified against this tree; no exploit was demonstrated, and no severity is claimed for them.
- The gitbook and i18n documentation still carry weak placeholder secret literals as examples. They are rejected at boot if copied verbatim, but the docs have not been swept.
