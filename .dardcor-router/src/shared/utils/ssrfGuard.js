
import dns from "node:dns";

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost"];

function ipv4ToInt(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

const BLOCKED_V4_RANGES = [
  [ipv4ToInt("0.0.0.0"), 8],
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("100.64.0.0"), 10],
  [ipv4ToInt("127.0.0.0"), 8],
  [ipv4ToInt("169.254.0.0"), 16],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16],
];

function isBlockedIpv4Int(ip) {
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return isBlockedIpv4Int(ip);
}

function parseHextets(s) {
  if (s === "") return [];
  const segs = s.split(":");
  const out = [];
  for (const seg of segs) {
    if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
    out.push(parseInt(seg, 16));
  }
  return out;
}

function parseIPv6ToGroups(rawHost) {
  let host = rawHost.toLowerCase();

  const v4TailMatch = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  let v4Groups = null;
  if (v4TailMatch) {
    const v4Int = ipv4ToInt(v4TailMatch[1]);
    if (v4Int === null) return null;
    v4Groups = [(v4Int >>> 16) & 0xffff, v4Int & 0xffff];
    host = host.slice(0, host.length - v4TailMatch[1].length);
    if (host.endsWith("::")) {
    } else if (host.endsWith(":")) {
      host = host.slice(0, -1);
    }
  }

  const doubleColonParts = host.split("::");
  if (doubleColonParts.length > 2) return null;

  let groups;
  if (doubleColonParts.length === 2) {
    const head = parseHextets(doubleColonParts[0]);
    const tail = parseHextets(doubleColonParts[1]);
    if (head === null || tail === null) return null;
    const v4Len = v4Groups ? v4Groups.length : 0;
    const missing = 8 - head.length - tail.length - v4Len;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail, ...(v4Groups || [])];
  } else {
    const all = parseHextets(host);
    if (all === null) return null;
    groups = [...all, ...(v4Groups || [])];
  }
  return groups.length === 8 ? groups : null;
}

function isBlockedIpv6Groups(g) {
  const isZero = (n) => g[n] === 0;
  if ([0, 1, 2, 3, 4, 5, 6].every(isZero) && g[7] === 1) return true;
  if (g.every((x) => x === 0)) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  const low32 = ((g[6] << 16) | g[7]) >>> 0;
  if ([0, 1, 2, 3, 4].every(isZero) && g[5] === 0xffff) return isBlockedIpv4Int(low32);
  if (g[0] === 0x0064 && g[1] === 0xff9b && [2, 3, 4, 5].every(isZero)) return isBlockedIpv4Int(low32);
  if ([0, 1, 2, 3, 4, 5].every(isZero) && low32 !== 0 && low32 !== 1) return isBlockedIpv4Int(low32);
  return false;
}

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function isBlockedHost(host) {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (isBlockedIpv4(host)) return true;
  if (host.includes(":")) {
    const groups = parseIPv6ToGroups(host.replace(/^\[|\]$/g, ""));
    if (groups && isBlockedIpv6Groups(groups)) return true;
  }
  return false;
}

export function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHost(host)) throw new Error("Blocked URL: internal host");
}

export async function assertPublicUrlResolved(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHost(host)) throw new Error("Blocked URL: internal host");

  const bracketless = host.replace(/^\[|\]$/g, "");
  if (ipv4ToInt(bracketless) !== null || bracketless.includes(":")) return;

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return;
  }
  for (const { address, family } of addresses) {
    if (family === 4 ? isBlockedIpv4(address) : isBlockedIpv6Groups(parseIPv6ToGroups(address) || [])) {
      throw new Error("Blocked URL: hostname resolves to an internal host");
    }
  }
}

export async function fetchPublic(url, init = {}, { maxRedirects = 5 } = {}) {
  await assertPublicUrlResolved(url);
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= maxRedirects) throw new Error("Blocked URL: too many redirects");
    const nextUrl = new URL(location, currentUrl).toString();
    await assertPublicUrlResolved(nextUrl);
    currentUrl = nextUrl;
  }
}
