"use strict";

// Canonical weak-secret boot policy (CommonJS). Single source of truth for the
// weak API_KEY_SECRET / MACHINE_ID_SALT lists and the boot assertions.
// Side-effect free on require: nothing reads env or disk at import time.
// Only the assertion functions throw, and only for a supplied (non-empty,
// trimmed) env value in the weak list. The error names the env variable but
// never the value itself.

const WEAK_API_KEY_SECRETS = [
  "endpoint-proxy-api-key-secret",
  "change-me-to-a-long-random-secret",
  "changeme",
  "secret",
];

const WEAK_MACHINE_ID_SALTS = [
  "endpoint-proxy-salt",
  "change-me-to-a-long-random-secret",
  "changeme",
  "secret",
];

const WEAK_JWT_SECRETS = [
  "change-me-to-a-long-random-secret",
  "your-secure-secret-change-this",
  "your-secure-secret-change-this-to-random-string",
  "your-secure-secret",
  "your-secret",
  "generated-secret-here",
  "omniroute-default-secret-change-me",
  "changeme",
  "secret",
];

const API_WEAK_SET = new Set(WEAK_API_KEY_SECRETS);
const MACHINE_WEAK_SET = new Set(WEAK_MACHINE_ID_SALTS);
const JWT_WEAK_SET = new Set(WEAK_JWT_SECRETS);

function assertStrongEnv(name, weakSet) {
  const value = (process.env[name] || "").trim();
  if (value && weakSet.has(value)) {
    throw new Error(`${name} is weak. Set ${name} to a strong value.`);
  }
}

function assertStrongApiKeySecret() {
  assertStrongEnv("API_KEY_SECRET", API_WEAK_SET);
}

function assertStrongMachineIdSalt() {
  assertStrongEnv("MACHINE_ID_SALT", MACHINE_WEAK_SET);
}

function assertStrongJwtSecret() {
  assertStrongEnv("JWT_SECRET", JWT_WEAK_SET);
}

function assertNoWeakSecrets() {
  assertStrongApiKeySecret();
  assertStrongMachineIdSalt();
  assertStrongJwtSecret();
}

module.exports = {
  WEAK_API_KEY_SECRETS,
  WEAK_MACHINE_ID_SALTS,
  WEAK_JWT_SECRETS,
  assertStrongApiKeySecret,
  assertStrongMachineIdSalt,
  assertStrongJwtSecret,
  assertNoWeakSecrets,
};
