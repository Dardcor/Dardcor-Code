/**
 * Dardcor Code - Token Theme (Task 166)
 * Mirrors: vs/platform/theme/common/tokenTheme.ts
 */

import { Color } from '../../core/math/color.js';

export interface ITokenColorCustomization {
	scope?: string | string[];
	settings: {
		foreground?: string;
		background?: string;
		fontStyle?: string;
	};
}

export class TokenTheme {
	private readonly _tokenColors: ITokenColorCustomization[];

	constructor(tokenColors: ITokenColorCustomization[] = []) {
		this._tokenColors = tokenColors;
	}

	match(scope: string): { foreground?: Color; fontStyle?: string } | undefined {
		for (let i = this._tokenColors.length - 1; i >= 0; i--) {
			const rule = this._tokenColors[i];
			const scopes = Array.isArray(rule.scope) ? rule.scope : rule.scope ? [rule.scope] : [];
			for (const s of scopes) {
				if (scope === s || scope.startsWith(s + '.')) {
					return {
						foreground: rule.settings.foreground ? Color.fromHex(rule.settings.foreground) : undefined,
						fontStyle: rule.settings.fontStyle,
					};
				}
			}
		}
		return undefined;
	}
}
