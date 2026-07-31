/**
 * Dardcor Code - Semantic Highlight Token Mapper (Task 193)
 * Mirrors: vs/platform/theme/common/tokenClassificationRegistry.ts
 */

import { Color } from '../../core/math/color.js';

export interface ISemanticTokenRule {
	selector: string; // e.g. "variable.readonly:typescript"
	style: {
		foreground?: Color;
		bold?: boolean;
		italic?: boolean;
		underline?: boolean;
	};
}

export class SemanticTokenTheme {
	private readonly _rules = new Map<string, ISemanticTokenRule['style']>();

	addRule(selector: string, style: ISemanticTokenRule['style']): void {
		this._rules.set(selector, style);
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
}
