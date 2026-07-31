/**
 * Dardcor Code - Proxy Agent Wrapper (Task 174)
 * Mirrors: vs/platform/request/node/proxy.ts corporate HTTP/SOCKS proxy wrapper
 */

export interface IProxyConfiguration {
	httpProxy?: string;
	httpsProxy?: string;
	noProxy?: string[];
}

export function resolveProxyURL(url: string, config: IProxyConfiguration): string | undefined {
	try {
		const parsed = new URL(url);
		if (config.noProxy) {
			for (const no of config.noProxy) {
				if (parsed.hostname.endsWith(no)) return undefined;
			}
		}
		if (parsed.protocol === 'https:' && config.httpsProxy) {
			return config.httpsProxy;
		}
		if (parsed.protocol === 'http:' && config.httpProxy) {
			return config.httpProxy;
		}
	} catch {
		return undefined;
	}
	return undefined;
}
