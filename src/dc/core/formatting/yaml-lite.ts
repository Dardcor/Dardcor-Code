/**
 * Dardcor Code - Lightweight YAML Config Reader
 */

export namespace YAMLLite {
	export function parse(yamlText: string): Record<string, any> {
		const result: Record<string, any> = {};
		const lines = yamlText.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const idx = trimmed.indexOf(':');
			if (idx !== -1) {
				const key = trimmed.substring(0, idx).trim();
				const val = trimmed.substring(idx + 1).trim();
				result[key] = val.replace(/^["']|["']$/g, '');
			}
		}
		return result;
	}
}
