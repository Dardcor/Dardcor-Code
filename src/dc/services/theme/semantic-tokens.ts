/**
 * Dardcor Code - LSP Semantic Highlight Token Mapping Engine (Task 193)
 * Mirrors: vs/platform/theme/common/tokenClassificationRegistry.ts + LSP semanticTokens delta decoder
 */

import { Color } from '../../core/math/color.js';
import { IThemeTokenColor } from './theme-service.js';

export interface ISemanticTokenRule {
	selector: string; // e.g. "variable.readonly:typescript"
	style: {
		foreground?: Color;
		bold?: boolean;
		italic?: boolean;
		underline?: boolean;
	};
}

export interface ILspSemanticTokenData {
	readonly line: number;
	readonly startChar: number;
	readonly length: number;
	readonly tokenTypeIndex: number;
	readonly tokenModifiers: number;
}

export interface ILspSemanticTokenOptions {
	readonly tokenTypes: string[];
	readonly tokenModifiers: string[];
}

export class SemanticTokenTheme {
	private readonly _rules = new Map<string, ISemanticTokenRule['style']>();

	addRule(selector: string, style: ISemanticTokenRule['style']): void {
		this._rules.set(selector, style);
	}

	removeRule(selector: string): void {
		this._rules.delete(selector);
	}

	resolveStyle(tokenType: string, modifiers: string[] = [], language?: string): ISemanticTokenRule['style'] | undefined {
		// Specific -> general matching
		if (language) {
			for (const mod of modifiers) {
				const full = `${tokenType}.${mod}:${language}`;
				if (this._rules.has(full)) return this._rules.get(full);
			}
			const langOnly = `${tokenType}:${language}`;
			if (this._rules.has(langOnly)) return this._rules.get(langOnly);
		}
		for (const mod of modifiers) {
			const modOnly = `${tokenType}.${mod}`;
			if (this._rules.has(modOnly)) return this._rules.get(modOnly);
		}
		return this._rules.get(tokenType);
	}

	/**
	 * Resolve an LSP token against a theme's token color rules.
	 * Falls back to the theme's built-in token colors, then to the rule map.
	 */
	resolveColor(tokenType: string, tokenColors: readonly IThemeTokenColor[], _theme?: { getColor(colorId: string): Color | undefined }): Color | undefined {
		for (const rule of tokenColors) {
			const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
			for (const scope of scopes) {
				if (scope === tokenType && rule.foreground) {
					return Color.fromHex(rule.foreground);
				}
			}
		}
		return this._rules.get(tokenType)?.foreground;
	}
}

/**
 * Decode an LSP "semanticTokens/full" response using delta encoding (5 ints per token).
 */
export function decodeLspSemanticTokens(data: number[], options: ILspSemanticTokenOptions): ILspSemanticTokenData[] {
	const tokens: ILspSemanticTokenData[] = [];
	let line = 0;
	let startChar = 0;

	for (let i = 0; i + 4 < data.length; i += 5) {
		const deltaLine = data[i];
		const deltaStartChar = data[i + 1];
		const length = data[i + 2];
		const tokenTypeIndex = data[i + 3];
		const tokenModifiers = data[i + 4];

		if (deltaLine > 0) {
			line += deltaLine;
			startChar = deltaStartChar;
		} else {
			startChar += deltaStartChar;
		}

		if (tokenTypeIndex >= 0 && tokenTypeIndex < options.tokenTypes.length) {
			tokens.push({ line, startChar, length, tokenTypeIndex, tokenModifiers });
		}
	}
	return tokens;
}

/**
 * Convert decoded LSP tokens into selectors understood by SemanticTokenTheme,
 * e.g. "variable.readonly:typescript".
 */
export function lspTokenToSelector(token: ILspSemanticTokenData, options: ILspSemanticTokenOptions, language?: string): string {
	const type = options.tokenTypes[token.tokenTypeIndex] ?? 'unknown';
	const mods: string[] = [];
	for (let bit = 0; bit < options.tokenModifiers.length; bit++) {
		if (token.tokenModifiers & (1 << bit)) {
			mods.push(options.tokenModifiers[bit]);
		}
	}
	const base = mods.length > 0 ? `${type}.${mods.join('.')}` : type;
	return language ? `${base}:${language}` : base;
}

export function fontStyleFromTokenStyle(style: ISemanticTokenRule['style']): string {
	const parts: string[] = [];
	if (style.bold) parts.push('bold');
	if (style.italic) parts.push('italic');
	if (style.underline) parts.push('underline');
	return parts.join(' ');
}
