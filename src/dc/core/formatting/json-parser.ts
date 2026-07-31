/**
 * Dardcor Code - Tolerant JSON Parser (Strips Comments & Trailing Commas)
 */

export namespace JSONParser {
	export function parse<T = any>(jsonText: string): T {
		const stripped = jsonText
			.replace(/\/\*[\s\S]*?\*\//g, '') // remove multi-line comments
			.replace(/\/\/.*/g, '')           // remove single-line comments
			.replace(/,\s*([\]}])/g, '$1');    // remove trailing commas
		return JSON.parse(stripped);
	}
}
