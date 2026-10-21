/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloudflare Worker / Vercel Edge Relay for OpenCode Zen Free Tier.
 *
 * Deploy this script to a free Cloudflare Worker (100,000 free requests/day)
 * to route OpenCode Zen requests through Cloudflare's global edge network.
 *
 * Because Cloudflare edge servers have hundreds of thousands of rotating datacenter IPs
 * in 330+ cities worldwide, requests passing through this relay will NEVER expose
 * your home ISP IP to OpenCode, bypassing IP rate limits indefinitely.
 *
 * Setup in Dardcor Router:
 * Set environment variable or config:
 *   OPENCODE_EDGE_RELAY_URL = "https://your-worker-name.workers.dev"
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const url = new URL(request.url);
    const targetBase = request.headers.get("x-relay-target") || "https://opencode.ai";
    const targetPath = request.headers.get("x-relay-path") || url.pathname + url.search;

    const destinationUrl = new URL(targetPath, targetBase);

    // Clone headers and remove relay-internal headers
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete("x-relay-target");
    forwardHeaders.delete("x-relay-path");
    forwardHeaders.delete("host");

    // Force stream and authentic OpenCode desktop identity
    if (!forwardHeaders.has("User-Agent")) {
      forwardHeaders.set("User-Agent", "opencode/stable/2.1.1/cli");
    }
    if (!forwardHeaders.has("x-opencode-client")) {
      forwardHeaders.set("x-opencode-client", "desktop");
    }

    const upstreamResponse = await fetch(destinationUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
      redirect: "follow",
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
