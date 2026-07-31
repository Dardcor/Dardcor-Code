export interface ITextMatePattern {
	match?: string;
	name?: string;
	begin?: string;
	end?: string;
	include?: string;
	captures?: Record<string, { name?: string }>;
	beginCaptures?: Record<string, { name?: string }>;
	endCaptures?: Record<string, { name?: string }>;
}

export interface ITextMateGrammar {
	patterns?: ITextMatePattern[];
	repository?: Record<string, ITextMatePattern>;
	name?: string;
}

export interface IMonarchRule {
	regex: RegExp | string;
	action: { token?: string; next?: string };
}

export class LspMonarchBridge {
	private _nextStateId = 0;

	public convertGrammar(grammar: ITextMateGrammar): IMonarchRule[] {
		const rules: IMonarchRule[] = [];
		this._convertPatterns(grammar.patterns ?? [], grammar, rules, grammar.name ?? 'grammar');
		return rules;
	}

	private _convertPatterns(patterns: ITextMatePattern[], grammar: ITextMateGrammar, rules: IMonarchRule[], rootName: string): void {
		for (const pattern of patterns) {
			this._convertPattern(pattern, grammar, rules, rootName);
		}
	}

	private _convertPattern(pattern: ITextMatePattern | undefined, grammar: ITextMateGrammar, rules: IMonarchRule[], rootName: string): void {
		if (!pattern) {
			return;
		}
		if (pattern.include) {
			this._convertInclude(pattern.include, grammar, rules, rootName);
			return;
		}
		const token = pattern.name
			?? pattern.captures?.['1']?.name
			?? pattern.beginCaptures?.['1']?.name
			?? pattern.endCaptures?.['1']?.name;
		if (pattern.match) {
			rules.push({ regex: pattern.match, action: { token } });
			return;
		}
		if (pattern.begin && pattern.end) {
			const stateName = `${rootName}-s${this._nextStateId++}`;
			rules.push({ regex: pattern.begin, action: { token, next: stateName } });
			rules.push({ regex: pattern.end, action: { next: '@pop' } });
			return;
		}
		if (pattern.begin) {
			const stateName = `${rootName}-s${this._nextStateId++}`;
			rules.push({ regex: pattern.begin, action: { token, next: stateName } });
		}
	}

	private _convertInclude(include: string, grammar: ITextMateGrammar, rules: IMonarchRule[], rootName: string): void {
		if (include === '$self' || include === '$base') {
			this._convertPatterns(grammar.patterns ?? [], grammar, rules, rootName);
			return;
		}
		if (include.startsWith('#')) {
			const referenced = grammar.repository?.[include.substring(1)];
			if (referenced) {
				this._convertPattern(referenced, grammar, rules, rootName);
			}
		}
	}
}
