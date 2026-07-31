/**
 * Dardcor Code - Cross-Platform Path Operations
 */

export namespace Path {
	export function normalize(path: string): string {
		return path.replace(/\\/g, '/').replace(/\/+/g, '/');
	}

	export function join(...parts: string[]): string {
		return normalize(parts.join('/'));
	}

	export function dirname(path: string): string {
		const norm = normalize(path);
		const idx = norm.lastIndexOf('/');
		if (idx === -1) return '.';
		if (idx === 0) return '/';
		return norm.substring(0, idx);
	}

	export function basename(path: string, ext?: string): string {
		const norm = normalize(path);
		const idx = norm.lastIndexOf('/');
		let name = idx === -1 ? norm : norm.substring(idx + 1);
		if (ext && name.endsWith(ext)) {
			name = name.substring(0, name.length - ext.length);
		}
		return name;
	}

	export function extname(path: string): string {
		const base = basename(path);
		const idx = base.lastIndexOf('.');
		if (idx === -1 || idx === 0) return '';
		return base.substring(idx);
	}
}
