/**
 * Dardcor Code - Corporate HTTP/SOCKS Proxy Wrapper (Task 174)
 * Mirrors: vs/platform/request/node/proxy.ts corporate HTTP/SOCKS proxy wrapper
 */

export interface IProxyConfiguration {
	httpProxy?: string;
	httpsProxy?: string;
	noProxy?: string[];
}

export interface IProxyInfo {
	readonly scheme: string;
	readonly host: string;
	readonly port: number;
	readonly username?: string;
	readonly password?: string;
	readonly raw: string;
}

export function parseProxyURL(proxyUrl: string): IProxyInfo | null {
	try {
		const url = new URL(proxyUrl);
		const scheme = url.protocol.replace(/:$/, '').toLowerCase();
		if (scheme !== 'http' && scheme !== 'https' && scheme !== 'socks' && scheme !== 'socks4' && scheme !== 'socks5') {
			return null;
		}
		const port = url.port ? Number(url.port) : (scheme === 'https' ? 443 : 1080);
		return {
			scheme,
			host: url.hostname,
			port,
			username: url.username ? decodeURIComponent(url.username) : undefined,
			password: url.password ? decodeURIComponent(url.password) : undefined,
			raw: proxyUrl,
		};
	} catch {
		return null;
	}
}

function matchesNoProxy(hostname: string, noProxy: string[]): boolean {
	for (const pattern of noProxy) {
		const p = pattern.trim();
		if (!p) continue;
		if (p === '*') return true;
		const target = p.startsWith('.') ? p.substring(1) : p;
		if (hostname === target) return true;
		if (hostname.endsWith(`.${target}`)) return true;
	}
	return false;
}

export function shouldBypassProxy(url: string, config: IProxyConfiguration): boolean {
	if (!config.noProxy || config.noProxy.length === 0) {
		return false;
	}
	try {
		const parsed = new URL(url);
		return matchesNoProxy(parsed.hostname, config.noProxy);
	} catch {
		return false;
	}
}

export function resolveProxyURL(url: string, config: IProxyConfiguration): string | undefined {
	try {
		const parsed = new URL(url);
		if (matchesNoProxy(parsed.hostname, config.noProxy ?? [])) {
			return undefined;
		}
		if (parsed.protocol === 'https:' && config.httpsProxy) {
			return config.httpsProxy;
		}
		if (parsed.protocol === 'http:' && config.httpProxy) {
			return config.httpProxy;
		}
		if (config.httpProxy) {
			return config.httpProxy;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function createProxyAgent(config: IProxyConfiguration) {
	const cache = new Map<string, IProxyInfo | null>();
	return {
		getProxyForUrl(url: string): IProxyInfo | null {
			const proxyUrl = resolveProxyURL(url, config);
			if (!proxyUrl) {
				return null;
			}
			if (!cache.has(proxyUrl)) {
				cache.set(proxyUrl, parseProxyURL(proxyUrl));
			}
			return cache.get(proxyUrl) ?? null;
		},
	};
}

export type ProxyAgent = ReturnType<typeof createProxyAgent>;
