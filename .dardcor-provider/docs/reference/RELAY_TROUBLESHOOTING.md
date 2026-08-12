---
title: "Relay Troubleshooting"
version: 3.8.43
lastUpdated: 2026-07-11
---

# Relay Troubleshooting

Relays (Vercel, Deno, Cloudflare) terminate the upstream connection on a
serverless backend so Dardcor Code can egress from a stable region while keeping
the provider API key server-side. This document covers the two failure modes
that operators hit in production and the recovery paths Dardcor Code ships for
each.

## How relay auth is stored

When you deploy a relay from **Settings → Proxy Pool → Deploy Relay**, the
deploy flow stores the relay's auth token in the proxy `notes` JSON field:

- If `STORAGE_ENCRYPTION_KEY` is set, the token is written as `relayAuthEnc`
  (AES-encrypted at rest).
- Otherwise it is written as plaintext `relayAuth`.

At request time `extractRelayAuth(notes)` returns whichever form is present,
so the relay keeps working across restarts.

## Failure mode 1 — undecryptable token after key rotation

**Symptom:** relays that previously worked now return upstream `401`/auth
errors after an environment or secret-manager rotation of
`STORAGE_ENCRYPTION_KEY`. The stored `relayAuthEnc` blob can no longer be
decrypted, so `extractRelayAuth` returns the empty string and the relay sends
no auth.

**Recovery — repair in place (no redeploy):**

1. Open **Settings → Proxy Pool**.
2. Relay rows whose auth is missing show a yellow `auth missing` badge and a
   **Repair** button.
3. Click **Repair**. Dardcor Code calls
   `POST /api/settings/proxies/[id]/repair-relay`, which:
   - decrypts `relayAuthEnc` with the **current** key,
   - writes the plaintext `relayAuth` back into `notes`,
   - returns `{ repaired: true, mode: "recovered" }`.

The relay resumes serving without re-entering any deploy credentials.

This only works if the current `STORAGE_ENCRYPTION_KEY` can still decrypt the
blob. If you rotated the key **without** a migration, the blob is
unrecoverable.

## Failure mode 2 — unrecoverable token (key rotated away)

**Symptom:** you clicked **Repair** and got
`{ repaired: false, mode: "redeploy", status: 409 }`.

**Recovery — redeploy:**

The stored token cannot be recovered with the current key. Re-deploy the relay
from the same modal you used originally (**Deploy Relay** menu → Vercel / Deno
/ Cloudflare). The deploy flow writes a fresh token (encrypted with the current
key) and the row's `auth missing` badge clears.

In the UI, the **Repair** button itself triggers the redeploy modal when the
token is unrecoverable, so you never have to hunt for it manually.

## Failure mode 3 — relay reachable but unhealthy

**Symptom:** the proxy test (`speed` button) shows the relay up but requests
still fail intermittently.

Check the relay awareness headers returned by Dardcor Code's auto-test probe
(see **Settings → Proxy Pool** and the `relayTested` / `relayAlive` counters):

- `x-relay-url` — which relay backend answered.
- `x-relay-mode` — `ts` | `bifrost` | `auto` for that request.
- `x-relay-attempts` — how many relay hops were tried before success.
- `x-relay-fallback` — `true` when the request fell back from the preferred
  backend to the TypeScript relay.

A high `x-relay-fallback` rate with low `relayAlive` means the sidecar
backend is unhealthy and you should either fix it or switch the relay backend
strategy to `ts` (see `RELAY_BACKEND_STRATEGY.md`).

## API reference

| Method | Path                                      | Body                    | Success                                                                                                                             | Failure                                                                           |
| ------ | ----------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST` | `/api/settings/proxies/[id]/repair-relay` | `{ "id": "<proxyId>" }` | `200 { repaired: true, mode: "recovered" }` when re-derived; `200 { repaired: false, mode: "noop" }` when plaintext already present | `409 { mode: "redeploy" }` unrecoverable; `400` not a relay type; `404` not found |

The list route `GET /api/settings/proxies` attaches a secret-free
`relayInfo: { isRelay, authMissing, repairMode }` to each item so the dashboard
can render the repair affordance without ever exposing the token.
