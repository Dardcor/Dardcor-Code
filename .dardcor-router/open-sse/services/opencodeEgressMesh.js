/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import net from "net";

const PUBLIC_SUBNETS = [
  [104, 28],
  [172, 217],
  [142, 250],
  [185, 220],
  [198, 51],
  [203, 0],
  [45, 33],
  [91, 108],
  [162, 158],
  [108, 162],
  [64, 233],
  [66, 249],
];

export function generateRandomPublicIp() {
  const subnet = PUBLIC_SUBNETS[Math.floor(Math.random() * PUBLIC_SUBNETS.length)];
  const b3 = Math.floor(Math.random() * 254) + 1;
  const b4 = Math.floor(Math.random() * 254) + 1;
  return `${subnet[0]}.${subnet[1]}.${b3}.${b4}`;
}

export function buildCloakedHeaders(existingHeaders = {}) {
  // Pass through headers cleanly. Cloudflare edge rejects client-supplied
  // cf-connecting-ip and true-client-ip with Error 1000 ("DNS points to prohibited IP").
  return {
    ...existingHeaders,
  };
}

export class OpencodeEgressMesh {
  constructor() {
    this.cooldowns = new Map();
    this.cooldownMs = 15 * 60 * 1000; // 15 minutes cooldown on 429
    this.torControlPort = parseInt(process.env.OPENCODE_TOR_CONTROL_PORT || "9051", 10);
    this.torControlHost = process.env.OPENCODE_TOR_CONTROL_HOST || "127.0.0.1";
    this.torProxy = process.env.OPENCODE_TOR_PROXY || "socks5://127.0.0.1:9050";
    this.edgeRelayUrl = process.env.OPENCODE_EDGE_RELAY_URL || "";
    this.customProxies = (process.env.OPENCODE_PROXY_POOL || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    this.proxyIndex = 0;
  }

  getRoutes() {
    const routes = [];

    // Route 1: Edge Relay (Cloudflare Worker / Vercel Edge relay)
    if (this.edgeRelayUrl) {
      routes.push({
        id: "edge-relay",
        type: "relay",
        vercelRelayUrl: this.edgeRelayUrl,
      });
    }

    // Route 2: Tor SOCKS5 circuit
    if (process.env.OPENCODE_USE_TOR === "1" || process.env.OPENCODE_TOR_PROXY) {
      routes.push({
        id: "tor-socks5",
        type: "proxy",
        url: this.torProxy,
        isTor: true,
      });
    }

    // Route 3: Custom Proxy Pool
    for (let i = 0; i < this.customProxies.length; i++) {
      routes.push({
        id: `custom-proxy-${i}`,
        type: "proxy",
        url: this.customProxies[i],
      });
    }

    // Route 4: Cloaked Direct (always available as baseline)
    routes.push({
      id: "cloaked-direct",
      type: "direct",
    });

    return routes;
  }

  isCoolingDown(routeId) {
    const expiry = this.cooldowns.get(routeId);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.cooldowns.delete(routeId);
      return false;
    }
    return true;
  }

  reportRateLimit(routeId) {
    if (!routeId) return;
    this.cooldowns.set(routeId, Date.now() + this.cooldownMs);

    // If Tor is the active route, signal NEWNYM to change exit node immediately
    if (routeId === "tor-socks5") {
      this.signalTorNewnym().catch(() => {});
    }
  }

  async signalTorNewnym() {
    return new Promise((resolve) => {
      try {
        const socket = net.createConnection(this.torControlPort, this.torControlHost);
        socket.setTimeout(2000);
        socket.on("connect", () => {
          socket.write("AUTHENTICATE \"\"\r\nSIGNAL NEWNYM\r\nQUIT\r\n");
        });
        socket.on("data", () => {
          socket.end();
          resolve(true);
        });
        socket.on("error", () => resolve(false));
        socket.on("timeout", () => {
          socket.destroy();
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  selectEgressRoute() {
    const allRoutes = this.getRoutes();
    const available = allRoutes.filter((r) => !this.isCoolingDown(r.id));
    const pool = available.length > 0 ? available : allRoutes;

    const route = pool[this.proxyIndex % pool.length];
    this.proxyIndex = (this.proxyIndex + 1) % pool.length;

    let proxyOptions = null;
    if (route.type === "relay" && route.vercelRelayUrl) {
      proxyOptions = { vercelRelayUrl: route.vercelRelayUrl };
    } else if (route.type === "proxy" && route.url) {
      proxyOptions = {
        enabled: true,
        connectionProxyEnabled: true,
        url: route.url,
      };
    }

    return {
      routeId: route.id,
      proxyOptions,
      isDirect: route.type === "direct",
    };
  }
}

export const opencodeEgressMesh = new OpencodeEgressMesh();
