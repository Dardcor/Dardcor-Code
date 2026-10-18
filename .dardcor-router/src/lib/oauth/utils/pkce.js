import crypto from "crypto";

export function generateCodeVerifier(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function generateState() {
  return crypto.randomBytes(32).toString("base64url");
}

export function generatePKCE(bytes = 32) {
  const codeVerifier = generateCodeVerifier(bytes);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  return {
    codeVerifier,
    codeChallenge,
    state,
  };
}
