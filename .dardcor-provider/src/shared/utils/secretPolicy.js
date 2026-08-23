// ESM view over the canonical CJS boot policy (secret-policy.cjs at repo root).
// Kept thin so Next/Vitest bundlers only see one source of truth for the weak
// lists and boot assertions.

import secretPolicy from "../../../secret-policy.cjs";

export const WEAK_API_KEY_SECRETS = secretPolicy.WEAK_API_KEY_SECRETS;
export const WEAK_MACHINE_ID_SALTS = secretPolicy.WEAK_MACHINE_ID_SALTS;
export const WEAK_JWT_SECRETS = secretPolicy.WEAK_JWT_SECRETS;
export const assertStrongApiKeySecret = secretPolicy.assertStrongApiKeySecret;
export const assertStrongMachineIdSalt = secretPolicy.assertStrongMachineIdSalt;
export const assertStrongJwtSecret = secretPolicy.assertStrongJwtSecret;
export const assertNoWeakSecrets = secretPolicy.assertNoWeakSecrets;
export default secretPolicy;
