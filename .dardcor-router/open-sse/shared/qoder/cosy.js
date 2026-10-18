
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

import {
  QODER_CLIENT_TYPE,
  QODER_DATA_POLICY,
  QODER_IDE_VERSION,
  QODER_LOGIN_VERSION,
  QODER_MACHINE_OS,
  QODER_MACHINE_TYPE,
  QODER_RSA_PUBLIC_KEY,
} from "./constants.js";

function generateAesKey() {
  return uuidv4().slice(0, 16);
}

function pkcs7Pad(data, blockSize) {
  const padding = blockSize - (data.length % blockSize);
  const padded = Buffer.alloc(data.length + padding, padding);
  data.copy(padded, 0);
  return padded;
}

function aesEncryptCbcBase64(plaintext, keyStr) {
  const keyBytes = Buffer.from(keyStr, "utf8");
  if (keyBytes.length !== 16) {
    throw new Error(`aes key must be 16 bytes, got ${keyBytes.length}`);
  }
  const iv = keyBytes.subarray(0, 16);
  const cipher = crypto.createCipheriv("aes-128-cbc", keyBytes, iv);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(Buffer.from(plaintext, "utf8"), 16);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("base64");
}

function rsaEncryptBase64(data) {
  const encrypted = crypto.publicEncrypt(
    { key: QODER_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(data, "utf8"),
  );
  return encrypted.toString("base64");
}

function encryptUserInfo(userInfo) {
  const aesKey = generateAesKey();
  const plaintext = JSON.stringify(userInfo);
  const infoB64 = aesEncryptCbcBase64(plaintext, aesKey);
  const cosyKeyB64 = rsaEncryptBase64(aesKey);
  return { cosyKey: cosyKeyB64, info: infoB64 };
}

function md5Hex(input) {
  return crypto.createHash("md5").update(input).digest("hex");
}

function computeSigPath(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl).pathname || "";
  } catch {
    return "";
  }
  if (pathname.startsWith("/algo")) {
    return pathname.slice("/algo".length);
  }
  return pathname;
}

export function generateMachineId() {
  return uuidv4();
}

export function buildCosyHeaders(body, requestUrl, creds) {
  if (!creds?.userId) throw new Error("cosy: user id is empty");
  if (!creds?.authToken) throw new Error("cosy: auth token is empty");

  const bodyBuf = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? Buffer.from(body, "latin1")
      : Buffer.from(body || []);

  const { cosyKey, info } = encryptUserInfo({
    uid: creds.userId,
    security_oauth_token: creds.authToken,
    name: creds.name || "",
    aid: "",
    email: creds.email || "",
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = uuidv4();

  const payloadJson = JSON.stringify({
    version: "v1",
    requestId,
    info,
    cosyVersion: QODER_IDE_VERSION,
    ideVersion: "",
  });
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64");

  const sigPath = computeSigPath(requestUrl);
  const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyBuf.toString("latin1")}\n${sigPath}`;
  const sig = md5Hex(Buffer.from(sigInput, "latin1"));

  const machineId = creds.machineId || generateMachineId();
  const bodyHash = md5Hex(bodyBuf);
  const bodyLength = String(bodyBuf.length);

  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userId,
    "Cosy-Date": timestamp,
    "Cosy-Version": QODER_IDE_VERSION,
    "Cosy-Machineid": machineId,
    "Cosy-Machinetoken": machineId,
    "Cosy-Machinetype": QODER_MACHINE_TYPE,
    "Cosy-Machineos": QODER_MACHINE_OS,
    "Cosy-Clienttype": QODER_CLIENT_TYPE,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLength,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QODER_DATA_POLICY,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QODER_LOGIN_VERSION,
    "X-Request-Id": uuidv4(),
  };
}
