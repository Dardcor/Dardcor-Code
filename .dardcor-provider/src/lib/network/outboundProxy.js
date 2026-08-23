function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const ALLOWED_PROXY_SCHEMES = ["http:", "https:", "socks5:", "socks4:", "socks5h:", "socks4a:"];

function validateProxyUrl(url) {
  if (!url) return null;
  if (/[\n\r`$]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROXY_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function applyOutboundProxyEnv(
  { outboundProxyEnabled, outboundProxyUrl, outboundNoProxy } = {}
) {
  if (typeof process === "undefined" || !process.env) return;
  const enabled = Boolean(outboundProxyEnabled);
  const proxyUrl = normalizeString(outboundProxyUrl);
  const noProxy = normalizeString(outboundNoProxy);

  // Internal marker env: new writes use MIAW_*; legacy NINE_ROUTER_* still read
  // so an already-managed child process (or old spawner) keeps working.
  const isManaged = () =>
    process.env.MIAW_PROXY_MANAGED === "1" || process.env.NINE_ROUTER_PROXY_MANAGED === "1";
  const clearManaged = () => {
    delete process.env.MIAW_PROXY_MANAGED;
    delete process.env.MIAW_PROXY_URL;
    delete process.env.MIAW_NO_PROXY;
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
    delete process.env.NINE_ROUTER_PROXY_URL;
    delete process.env.NINE_ROUTER_NO_PROXY;
  };

  // If disabled, only clear env vars we previously managed.
  if (!enabled) {
    if (isManaged()) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      clearManaged();
    }
    return;
  }

  // When enabled:
  // - If values are provided, write them and mark as managed
  // - If values are empty, do not touch externally-provided env,
  //   but do clear values we previously managed.
  const wasManaged = isManaged();
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.MIAW_PROXY_URL;
      delete process.env.NINE_ROUTER_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.MIAW_NO_PROXY;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
  }

  if (proxyUrl) {
    const validated = validateProxyUrl(proxyUrl);
    if (validated) {
      process.env.HTTP_PROXY = validated;
      process.env.HTTPS_PROXY = validated;
      process.env.ALL_PROXY = validated;
      process.env.MIAW_PROXY_URL = validated;
      managed = true;
    }
  }

  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    process.env.MIAW_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.MIAW_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    // If we previously managed env but now cleared everything, drop the marker.
    clearManaged();
  }
}
