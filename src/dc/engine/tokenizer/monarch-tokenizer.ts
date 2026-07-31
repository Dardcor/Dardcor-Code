/**
 * Dardcor Code - Monarch Declarative Syntax Highlighter Engine (Task 227)
 * Mirrors: vs/editor/common/languages/monarch/monarchCompile.ts + monarchLexer.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { LineToken } from '../model/line-tokens';

export interface IMonarchLanguageRule {
	readonly regex?: string | RegExp;
	readonly match?: RegExp;

	readonly token?: string;
	readonly next?: string;
	readonly push?: string;
	readonly pop?: boolean;
	readonly switchTo?: string;
	readonly include?: string;
}

export interface IMonarchLanguage {
	readonly name: string;
	readonly defaultToken?: string;
	readonly ignoreCase?: boolean;
	readonly tokenizer: Record<string, IMonarchLanguageRule[]>;
}

export interface IMonarchState {
	readonly stack: string[];
}



export interface IMonarchTokenizeResult {
	readonly tokens: LineToken[];
	readonly state: IMonarchState;
}

interface ICompiledRule {
	readonly regex: RegExp;
	readonly token?: string;
	readonly next?: string;
	readonly push?: string;
	readonly pop?: boolean;
	readonly switchTo?: string;
}

export class MonarchTokenizer extends Disposable {
	private readonly _compiled: Map<string, ICompiledRule[]> = new Map();

	constructor(private readonly _language: IMonarchLanguage) {
		super();
	}

	getLanguageName(): string {
		return this._language.name;
	}

	getInitialState(): IMonarchState {
		return { stack: ['root'] };
	}

	tokenizeLine(line: string, state?: IMonarchState | null): IMonarchTokenizeResult {
		const stack: string[] = state && state.stack.length > 0 ? [...state.stack] : ['root'];
		const tokens: LineToken[] = [];
		const length = line.length;
		let pos = 0;
		let lastTokenEnd = 0;

		while (pos < length) {
			const stateName = stack[stack.length - 1];
			const rules = this._getRules(stateName);
			let matched = false;

			for (const rule of rules) {
				rule.regex.lastIndex = pos;
				const match = rule.regex.exec(line);
				if (match && match.index === pos && match[0].length > 0) {
					const tokenType = rule.token ?? this._language.defaultToken ?? 'text';
					tokens.push(new LineToken(pos, pos + match[0].length, 0, tokenType));
					lastTokenEnd = pos + match[0].length;
					this._applyAction(stack, rule);
					pos = lastTokenEnd;
					matched = true;
					break;
				}
			}

			if (!matched) {
				pos++;
			}
		}

		return { tokens: this._mergeAdjacent(tokens), state: { stack } };
	}

	private _applyAction(stack: string[], rule: ICompiledRule): void {
		if (rule.pop && stack.length > 1) {
			stack.pop();
		}
		if (rule.push) {
			stack.push(rule.push);
		} else if (rule.switchTo) {
			stack.length = 0;
			stack.push(rule.switchTo);
		}
		if (rule.next && stack.length > 0) {
			stack[stack.length - 1] = rule.next;
		}
	}

	private _getRules(stateName: string): ICompiledRule[] {
		const cached = this._compiled.get(stateName);
		if (cached) {
			return cached;
		}
		const sourceRules = this._language.tokenizer[stateName];
		if (!sourceRules) {
			const empty: ICompiledRule[] = [];
			this._compiled.set(stateName, empty);
			return empty;
		}
		const compiled = this._compileRules(sourceRules, new Set<string>());
		this._compiled.set(stateName, compiled);
		return compiled;
	}

	private _compileRules(rules: IMonarchLanguageRule[], expanding: Set<string>): ICompiledRule[] {
		const result: ICompiledRule[] = [];
		for (const rule of rules) {
			if (rule.include) {
				if (expanding.has(rule.include)) {
					continue;
				}
				const included = this._language.tokenizer[rule.include];
				if (included) {
					const nextSet = new Set(expanding);
					nextSet.add(rule.include);
					result.push(...this._compileRules(included, nextSet));
				}
				continue;
			}
			const source = rule.regex ?? (rule.match ? rule.match.source : null);
			if (!source) {
				continue;
			}
			let flags = 'g';
			if (this._language.ignoreCase) {
				flags += 'i';
			}
			let regex: RegExp;
			try {
				regex = new RegExp(source, flags);
			} catch {
				continue;
			}
			result.push({
				regex,
				token: rule.token,
				next: rule.next,
				push: rule.push,
				pop: rule.pop,
				switchTo: rule.switchTo,
			});
		}
		return result;
	}

	private _mergeAdjacent(tokens: LineToken[]): LineToken[] {
		if (tokens.length <= 1) {
			return tokens;
		}
		const merged: LineToken[] = [];
		for (const token of tokens) {
			const last = merged[merged.length - 1];
			if (last && last.type === token.type && last.endOffset === token.startOffset) {
				merged[merged.length - 1] = new LineToken(last.startOffset, token.endOffset, 0, last.type);
			} else {
				merged.push(token);
			}
		}
		return merged;
	}
}

/**
 * Built-in simplified Monarch grammars for common languages.
 */
const JAVASCRIPT_GRAMMAR: IMonarchLanguage = {
	name: 'javascript',
	defaultToken: 'identifier',
	tokenizer: {
		root: [
			{ regex: /\s+/, token: 'whitespace' },
			{ regex: /\/\/.*$/, token: 'comment' },
			{ regex: /\/\*/, token: 'comment', push: 'comment' },
			{ regex: /"(?:[^"\\\n]|\\.)*"/, token: 'string' },
			{ regex: /'(?:[^'\\\n]|\\.)*'/, token: 'string' },
			{ regex: /`(?:[^`\\]|\\.)*`/, token: 'string' },
			{ regex: /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|this|import|export|from|default|async|await|yield|try|catch|finally|throw|with|static|get|set|null|undefined|true|false)\b/, token: 'keyword' },
			{ regex: /\b(?:string|number|boolean|any|unknown|never|void|object|symbol|bigint|interface|type|enum|namespace|public|private|protected|readonly|implements|abstract|declare|as|satisfies)\b/, token: 'type' },
			{ regex: /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, token: 'number' },
			{ regex: /@[a-zA-Z_]\w*/, token: 'annotation' },
			{ regex: /[a-zA-Z_$][\w$]*/, token: 'identifier' },
			{ regex: /[+\-*/%&|^!~<>=?:]+/, token: 'operator' },
			{ regex: /[{}()[\];,.]/, token: 'delimiter' },
		],
		comment: [
			{ regex: /\*\//, token: 'comment', pop: true },
			{ regex: /[^]+/, token: 'comment' },
		],
	},
};

const JSON_GRAMMAR: IMonarchLanguage = {
	name: 'json',
	defaultToken: 'identifier',
	tokenizer: {
		root: [
			{ regex: /\s+/, token: 'whitespace' },
			{ regex: /"(?:[^"\\]|\\.)*"/, token: 'string' },
			{ regex: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, token: 'number' },
			{ regex: /\b(?:true|false|null)\b/, token: 'keyword' },
			{ regex: /[{}[\],:]/, token: 'delimiter' },
		],
	},
};

const HTML_GRAMMAR: IMonarchLanguage = {
	name: 'html',
	ignoreCase: true,
	defaultToken: 'text',
	tokenizer: {
		root: [
			{ regex: /\s+/, token: 'whitespace' },
			{ regex: /<!--/, token: 'comment', push: 'comment' },
			{ regex: /<!doctype[^>]*>/, token: 'keyword' },
			{ regex: /<\/?[a-zA-Z][\w-]*/, token: 'tag', push: 'tag' },
			{ regex: />/, token: 'delimiter' },
			{ regex: /[^<]+/, token: 'text' },
		],
		tag: [
			{ regex: /\s+/, token: 'whitespace' },
			{ regex: /"[^"]*"/, token: 'string' },
			{ regex: /'[^']*'/, token: 'string' },
			{ regex: /[a-zA-Z_:][\w:.-]*/, token: 'attribute' },
			{ regex: /=/, token: 'operator' },
			{ regex: /\/>/, token: 'delimiter', pop: true },
			{ regex: />/, token: 'delimiter', pop: true },
		],
		comment: [
			{ regex: /-->/, token: 'comment', pop: true },
			{ regex: /[^]+/, token: 'comment' },
		],
	},
};

const CSS_GRAMMAR: IMonarchLanguage = {
	name: 'css',
	defaultToken: 'identifier',
	tokenizer: {
		root: [
			{ regex: /\s+/, token: 'whitespace' },
			{ regex: /\/\*/, token: 'comment', push: 'comment' },
			{ regex: /"(?:[^"\\\n]|\\.)*"/, token: 'string' },
			{ regex: /'[^'\n]*'/, token: 'string' },
			{ regex: /#[0-9a-fA-F]{3,8}\b/, token: 'constant' },
			{ regex: /-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex|pt|cm|mm|in)?\b/, token: 'number' },
			{ regex: /@[a-zA-Z-]+/, token: 'annotation' },
			{ regex: /--?[a-zA-Z][\w-]*/, token: 'variable' },
			{ regex: /[a-zA-Z-][\w-]*(?=\s*:)/, token: 'property' },
			{ regex: /[a-zA-Z-][\w-]*/, token: 'selector' },
			{ regex: /[{}();,.:>+~[\]]/, token: 'delimiter' },
		],
		comment: [
			{ regex: /\*\//, token: 'comment', pop: true },
			{ regex: /[^]+/, token: 'comment' },
		],
	},
};

const PYTHON_GRAMMAR: IMonarchLanguage = {
	name: 'python',
	defaultToken: 'identifier',
	tokenizer: {
		root: [
			{ regex: /\s+/, token: 'whitespace' },
			{ regex: /#[^\n]*/, token: 'comment' },
			{ regex: /(?:[rRuUbBfF]{1,2})?"""/, token: 'string', push: 'triple' },
			{ regex: /(?:[rRuUbBfF]{1,2})?'''/, token: 'string', push: 'triple' },
			{ regex: /[rRuUbBfF]?"(?:[^"\\\n]|\\.)*"/, token: 'string' },
			{ regex: /[rRuUbBfF]?'(?:[^'\\\n]|\\.)*'/, token: 'string' },
			{ regex: /\b(?:def|class|if|elif|else|for|while|return|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|async|await|in|is|not|and|or)\b/, token: 'keyword' },
			{ regex: /\b(?:None|True|False|self)\b/, token: 'keyword' },
			{ regex: /@[a-zA-Z_]\w*/, token: 'annotation' },
			{ regex: /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[jJ]?\b/, token: 'number' },
			{ regex: /[a-zA-Z_]\w*/, token: 'identifier' },
			{ regex: /[+\-*/%&|^~<>=@]+/, token: 'operator' },
			{ regex: /[(){}\[\]:;,.]/, token: 'delimiter' },
		],
		triple: [
			{ regex: /"""/, token: 'string', pop: true },
			{ regex: /'''/, token: 'string', pop: true },
			{ regex: /[^]+/, token: 'string' },
		],
	},
};

const PLAINTEXT_GRAMMAR: IMonarchLanguage = {
	name: 'plaintext',
	defaultToken: 'text',
	tokenizer: {
		root: [{ regex: /[^]+/, token: 'text' }],
	},
};

const BUILTIN_LANGUAGES: Record<string, IMonarchLanguage> = {
	javascript: JAVASCRIPT_GRAMMAR,
	typescript: JAVASCRIPT_GRAMMAR,
	json: JSON_GRAMMAR,
	html: HTML_GRAMMAR,
	css: CSS_GRAMMAR,
	python: PYTHON_GRAMMAR,
	plaintext: PLAINTEXT_GRAMMAR,
};

export namespace MonarchLanguages {
	export function getLanguage(languageId: string | undefined | null): IMonarchLanguage | null {
		if (!languageId) {
			return PLAINTEXT_GRAMMAR;
		}
		const id = languageId.toLowerCase();
		return BUILTIN_LANGUAGES[id] ?? null;
	}

	export function registerLanguage(languageId: string, language: IMonarchLanguage): void {
		BUILTIN_LANGUAGES[languageId.toLowerCase()] = language;
	}

	export function getRegisteredLanguageIds(): string[] {
		return Object.keys(BUILTIN_LANGUAGES);
	}
}

/**
 * Maps a Monarch token scope name to a CSS class used by the line renderer.
 */
export function tokenTypeToClassName(type: string): string {
	return `dc-token-${type.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
}
