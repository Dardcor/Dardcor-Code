import crypto from "node:crypto";

import { AWS_SIGV4 } from "../config/awsConstants.js";


export function escapeUri(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(payload) {
  return crypto
    .createHash("sha256")
    .update(payload ?? "", "utf8")
    .digest("hex");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function formatSigningDate(date) {
  const amzDate = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function canonicalPath(pathname, doubleEncodePath) {
  if (!doubleEncodePath) return pathname || "/";
  const segments = (pathname || "/")
    .split("/")
    .map((segment) => escapeUri(segment));
  return segments.join("/") || "/";
}

function canonicalizeHeaders(headers) {
  const entries = Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim().replace(/\s+/g, " "),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    canonicalHeaders: entries
      .map(([name, value]) => `${name}:${value}\n`)
      .join(""),
    signedHeaders: entries.map(([name]) => name).join(";"),
  };
}

export function signAwsRequest({
  method,
  url,
  headers = {},
  body = "",
  region,
  service,
  credentials,
  doubleEncodePath = true,
  date = new Date(),
}) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials || {};
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS SigV4 requires both accessKeyId and secretAccessKey");
  }

  const parsed = new URL(url);

  if (parsed.search) {
    throw new Error(
      `AWS SigV4 signing does not support query strings (got ${JSON.stringify(parsed.search)}). ` +
        "Move the parameters into the request body, or add proper query canonicalisation first.",
    );
  }

  const { amzDate, dateStamp } = formatSigningDate(date);
  const payloadHash = sha256Hex(body);

  const headersToSign = {
    ...headers,
    host: parsed.host,
    [AWS_SIGV4.dateHeader]: amzDate,
    ...(sessionToken ? { [AWS_SIGV4.securityTokenHeader]: sessionToken } : {}),
  };
  const { canonicalHeaders, signedHeaders } =
    canonicalizeHeaders(headersToSign);

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(parsed.pathname, doubleEncodePath),
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/${AWS_SIGV4.terminator}`;
  const stringToSign = [
    AWS_SIGV4.algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = [dateStamp, region, service, AWS_SIGV4.terminator].reduce(
    (key, part) => hmac(key, part),
    `${AWS_SIGV4.keyPrefix}${secretAccessKey}`,
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    ...headersToSign,
    Authorization:
      `${AWS_SIGV4.algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
