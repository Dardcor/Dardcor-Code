/**
 * Dardcor Code - Color Scope Matching Engine (Task 238)
 * Mirrors: vs/platform/theme/common/tokenTheme.ts + colorRegistry (theme fallback)
 */

import { Color } from '../../core/math/color.js';
import { getColorRegistry, ColorTokens } from '../../services/theme/color-registry.js';
import { IColorTheme } from '../../services/theme/theme-service.js';

export interface ITokenThemeRule {
	readonly scope: string | string[];
	readonly foreground?: string;
	readonly background?: string;
	readonly fontStyle?: string;
}

export interface ITokenThemeRuleMatch {
	readonly foreground: string;
	readonly background?: string;
	readonly fontStyle?: string;
}

const DEFAULT_FALLBACK_RULES: readonly ITokenThemeRule[] = [
	{ scope: ['keyword', 'storage', 'control'], foreground: '#569cd6' },
	{ scope: 'string', foreground: '#ce9178' },
	{ scope: 'comment', foreground: '#6a9955' },
	{ scope: 'function', foreground: '#dcdcaa' },
	{ scope: 'number', foreground: '#b5cea8' },
	{ scope: 'type', foreground: '#4ec9b0' },
	{ scope: 'variable', foreground: '#9cdcfe' },
	{ scope: 'constant', foreground: '#569cd6' },
	{ scope: 'tag', foreground: '#569cd6' },
	{ scope: 'parameter', foreground: '#9cdcfe' },
];

export class TokenThemeRules {
	private readonly _rules: readonly ITokenThemeRule[];

	constructor(rules: readonly ITokenThemeRule[] = DEFAULT_FALLBACK_RULES) {
		this._rules = [...rules];
	}

	public static fromTheme(theme: IColorTheme | undefined): TokenThemeRules {
		if (theme && theme.tokenColors && theme.tokenColors.length > 0) {
			return new TokenThemeRules(theme.tokenColors as readonly ITokenThemeRule[]);
		}
		return TokenThemeRules.fromColorRegistry(theme?.isDark() ? 'dark' : 'light');
	}

	public static fromColorRegistry(kind: 'light' | 'dark' | 'hc' = 'dark'): TokenThemeRules {
		const registry = getColorRegistry();
		const rules: ITokenThemeRule[] = [];
		for (const rule of DEFAULT_FALLBACK_RULES) {
			rules.push({ ...rule });
		}
		const editorForeground = registry.getColor(ColorTokens.editorForeground, kind);
		if (editorForeground) {
			rules.push({ scope: '', foreground: editorForeground.toString() });
		}
		return new TokenThemeRules(rules);
	}

	public match(scope: string): ITokenThemeRuleMatch | undefined {
		for (let i = this._rules.length - 1; i >= 0; i--) {
			const rule = this._rules[i];
			const scopes = Array.isArray(rule.scope) ? rule.scope : rule.scope ? [rule.scope] : [];
			for (const s of scopes) {
				if (scope === s || scope.startsWith(s + '.')) {
					if (rule.foreground === undefined && rule.background === undefined && rule.fontStyle === undefined) {
						continue;
					}
					return {
						foreground: rule.foreground ?? this.getDefaultForeground(),
						background: rule.background,
						fontStyle: rule.fontStyle,
					};
				}
			}
		}
		return undefined;
	}

	public resolveColor(scope: string): string {
		const match = this.match(scope);
		return match ? match.foreground : this.getDefaultForeground();
	}

	public resolveColorWithFallback(scope: string, fallbackColor: string): string {
		const match = this.match(scope);
		return match ? match.foreground : fallbackColor;
	}

	public getDefaultForeground(): string {
		const match = this.match('');
		return match ? match.foreground : '#d4d4d4';
	}

	public static scopeToColor(scope: string, rules: TokenThemeRules = new TokenThemeRules()): string {
		return rules.resolveColor(scope);
	}

	public static colorFromScope(scope: string): Color | null {
		const match = DEFAULT_FALLBACK_RULES.find((rule) => {
			const scopes = Array.isArray(rule.scope) ? rule.scope : rule.scope ? [rule.scope] : [];
			return scopes.some((s) => scope === s || scope.startsWith(s + '.'));
		});
		if (match?.foreground) {
			try {
				return Color.fromHex(match.foreground);
			} catch {
				return null;
			}
		}
		return null;
	}
}
