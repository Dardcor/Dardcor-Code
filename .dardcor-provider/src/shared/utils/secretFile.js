import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { WEAK_MACHINE_ID_SALTS } from "@/shared/utils/secretPolicy.js";

// Backward-compat alias: machineId.js consumes the canonical policy list.
export const MACHINE_ID_SALT_WEAK = WEAK_MACHINE_ID_SALTS;

/**
 * Load a secret from env → persisted file → generate and persist.
 * Refuses known-weak values (both env and file).
 * @param {string} fileName - file name under DATA_DIR
 * @param {string} envName - env variable to check first
 * @param {string[]} weakValues - values to reject as insecure
 * @returns {string}
 */
export function loadOrCreateSecretFile(fileName, envName, weakValues) {
  const weak = new Set(weakValues);

  // 1. Check env
  const envVal = (process.env[envName] || "").trim();
  if (envVal) {
    if (weak.has(envVal)) {
      throw new Error(
        `${envName} is weak. Set ${envName} to a strong value.`,
      );
    }
    return envVal;
  }

  // 2. Check persisted file
  const file = path.join(DATA_DIR, fileName);
  try {
    const content = fs.readFileSync(file, "utf8").trim();
    if (content) {
      if (weak.has(content)) {
        throw new Error(
          `Persisted ${fileName} is weak. Delete the file and set ${envName} to a strong value.`,
        );
      }
      fs.chmodSync(file, 0o600);
      return content;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  // 3. Generate and persist
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return generated;
}
