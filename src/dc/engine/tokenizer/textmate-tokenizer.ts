/**
 * Dardcor Code - TextMate Regex Tokenizer Adapter (Task 226)
 * Mirrors: vs/editor/common/languages/textMate/tokenizationSupport.ts
 * Attempts to load oniguruma-backed TextMate grammars through a guarded
 * dynamic import; falls back to the built-in Monarch tokenizer.
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { LineToken } from '../model/line-tokens.js';
import { MonarchLanguages, MonarchTokenizer } from './monarch-tokenizer.js';

export interface ITextMateTokenizeResult {
	readonly tokens: LineToken[];
	readonly state: unknown;
}

export interface ITextMateTokenizeState {
	readonly lineNumber: number;
	readonly tmState: unknown;
}

const LANG_TO_SCOPE: Record<string, string> = {
	javascript: 'source.js',
	typescript: 'source.ts',
	json: 'source.json',
	html: 'text.html.basic',
	css: 'source.css',
	python: 'source.python',
};

export class TextMateTokenizer extends Disposable {
	private _state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
	private _grammar: any = null;
	private readonly _monarch: MonarchTokenizer;
	private readonly _onDidChangeState = this._register(new Emitter<'ready' | 'failed'>());
	readonly onDidChangeState: Event<'ready' | 'failed'> = this._onDidChangeState.event;

	constructor(private readonly _languageId: string) {
		super();
		const grammar = MonarchLanguages.getLanguage(_languageId);
		this._monarch = new MonarchTokenizer(grammar ?? MonarchLanguages.getLanguage('plaintext')!);
		this._ensureInit();
	}

	isTextMateActive(): boolean {
		return this._state === 'ready' && !!this._grammar;
	}

	getState(): 'idle' | 'loading' | 'ready' | 'failed' {
		return this._state;
	}

	/**
	 * Tokenizes a line synchronously. Uses TextMate when available, otherwise
	 * falls back to the Monarch engine.
	 */
	tokenizeLine(line: string, state?: ITextMateTokenizeState | null): ITextMateTokenizeResult {
		if (this.isTextMateActive() && this._grammar) {
			try {
				const tmState = state ? (state as ITextMateTokenizeState).tmState : null;
				const result = this._grammar.tokenizeLine(line, tmState);
				return {
					tokens: this._mapTokens(result.tokens, line.length),
					state: { lineNumber: (state ? (state as ITextMateTokenizeState).lineNumber : 0) + 1, tmState: result.ruleStack },
				};
			} catch {
				// fall through to the monarch fallback
			}
		}
		const monarchStack = state
			? ((state as ITextMateTokenizeState).tmState as { stack?: string[] } | null)?.stack ?? ['root']
			: ['root'];
		const result = this._monarch.tokenizeLine(line, { stack: monarchStack });
		return {
			tokens: result.tokens,
			state: { lineNumber: (state ? (state as ITextMateTokenizeState).lineNumber : 0) + 1, tmState: { stack: result.state.stack } },
		};
	}

	getInitialState(): ITextMateTokenizeState {
		return { lineNumber: 0, tmState: null };
	}

	private _mapTokens(tmTokens: readonly { startIndex: number; endIndex: number; scopes: string[] }[], lineLength: number): LineToken[] {
		const tokens: LineToken[] = [];
		for (const t of tmTokens) {
			const start = Math.max(0, t.startIndex);
			const end = Math.min(lineLength, t.endIndex);
			if (end <= start) {
				continue;
			}
			const scope = t.scopes.length > 0 ? t.scopes[0] : 'text';
			tokens.push(new LineToken(start, end, 0, scopeToType(scope)));
		}
		return tokens;
	}

	private async _ensureInit(): Promise<void> {
		if (this._state !== 'idle') {
			return;
		}
		this._state = 'loading';
		try {
			const tmSpecifier = 'vscode-textmate';
			const onigSpecifier = 'vscode-oniguruma';
			const tm = await import(tmSpecifier);
			const onig = await import(onigSpecifier);
			if (!tm.Registry || !onig.createOnigScanner || !onig.createOnigString) {
				throw new Error('TextMate runtime unavailable');
			}
			const registry = new tm.Registry({
				onigLib: Promise.resolve({
					createOnigScanner: (sources: string[]) => onig.createOnigScanner(sources),
					createOnigString: (str: string) => onig.createOnigString(str),
				}),
				loadGrammar: async () => null,
			});
			const scopeName = LANG_TO_SCOPE[this._languageId];
			const grammar = await registry.loadGrammar(scopeName ?? 'text.html.basic');
			if (!grammar) {
				throw new Error('No grammar available for language: ' + this._languageId);
			}
			this._grammar = grammar;
			this._state = 'ready';
		} catch {
			this._state = 'failed';
		}
		this._onDidChangeState.fire(this._state === 'ready' ? 'ready' : 'failed');
	}
}

/**
 * Reduces a TextMate scope name to a coarse Monarch-style token type so the
 * shared render pipeline can style it.
 */
export function scopeToType(scope: string): string {
	const segments = scope.split('.');
	const first = segments[0] ?? 'text';
	switch (first) {
		case 'comment': return 'comment';
		case 'keyword': return segments.length > 2 ? 'keyword' : 'keyword';
		case 'string': return 'string';
		case 'constant': return 'number';
		case 'number': return 'number';
		case 'variable': return 'variable';
		case 'entity': return segments.includes('name') && segments.includes('tag') ? 'tag' : 'identifier';
		case 'meta': return 'identifier';
		case 'storage': return 'type';
		case 'punctuation': return 'delimiter';
		case 'markup': return 'text';
		default: return 'identifier';
	}
}
