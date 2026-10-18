import crypto from "crypto";
import { XIAOMI_MIMO_CONFIG } from "../constants/oauth.js";


export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeyB64 = publicKeyDer.toString("base64");

  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" });

  return { publicKey: publicKeyB64, privateKeyDer };
}

export function decryptCallback(privateKeyDer, encryptedB64) {
  const raw = Buffer.from(encryptedB64, "base64");

  if (raw.length < 12 + 32 + 16 + 1) {
    throw new Error(`Encrypted payload too short: ${raw.length} bytes`);
  }

  const nonce = raw.subarray(0, 12);
  const ephemeralPubRaw = raw.subarray(12, 44);
  const ciphertextAndTag = raw.subarray(44);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

  const ephemeralPub = crypto.createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      ephemeralPubRaw,
    ]),
    format: "der",
    type: "spki",
  });

  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });

  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey: ephemeralPub });
  const derivedKey = crypto.createHash("sha256").update(sharedSecret).digest();

  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const parsed = JSON.parse(decrypted.toString("utf-8"));

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Decrypted payload is not a valid object");
  }

  return {
    uid: parsed.uid || null,
    sk: parsed.sk || null,
    url: parsed.url || XIAOMI_MIMO_CONFIG.defaultBaseUrl,
  };
}

export function buildAuthorizeUrl(publicKey, redirectUri, keyName) {
  const params = new URLSearchParams({
    pk: publicKey,
    redirect_uri: redirectUri,
    kn: XIAOMI_MIMO_CONFIG.kn,
  });
  if (keyName) params.set("key_name", keyName);
  return `${XIAOMI_MIMO_CONFIG.platformUrl}/authorize?${params.toString()}`;
}

export function getKeyName() {
  const machineId = crypto
    .createHash("sha256")
    .update(`${process.platform}-${process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown"}`)
    .digest("hex")
    .slice(0, 8);
  return `dardcor-code-xmd-${machineId}`;
}
