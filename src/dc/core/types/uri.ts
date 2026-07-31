/**
 * Dardcor Code - RFC-3986 Compliant URI Impl
 */

export class URI {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;

	constructor(scheme: string, authority?: string, path?: string, query?: string, fragment?: string) {
		this.scheme = scheme || '';
		this.authority = authority || '';
		this.path = path || '';
		this.query = query || '';
		this.fragment = fragment || '';
	}

	static parse(value: string): URI {
		try {
			const u = new URL(value);
			return new URI(
				u.protocol.replace(':', ''),
				u.host,
				u.pathname,
				u.search.replace('?', ''),
				u.hash.replace('#', '')
			);
		} catch {
			return new URI('file', '', value);
		}
	}

	static file(path: string): URI {
		let authority = '';
		let normalizedPath = path.replace(/\\/g, '/');
		if (normalizedPath.startsWith('//')) {
			const idx = normalizedPath.indexOf('/', 2);
			if (idx !== -1) {
				authority = normalizedPath.substring(2, idx);
				normalizedPath = normalizedPath.substring(idx);
			}
		}
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = '/' + normalizedPath;
		}
		return new URI('file', authority, normalizedPath);
	}

	static from(components: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): URI {
		return new URI(components.scheme, components.authority, components.path, components.query, components.fragment);
	}

	toString(): string {
		let res = `${this.scheme}://`;
		if (this.authority) {
			res += this.authority;
		}
		res += this.path;
		if (this.query) {
			res += `?${this.query}`;
		}
		if (this.fragment) {
			res += `#${this.fragment}`;
		}
		return res;
	}

	toJSON(): any {
		return {
			$mid: 1,
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment
		};
	}
}
