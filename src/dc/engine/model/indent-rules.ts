/**
 * Dardcor Code - Auto-Indentation Rule Parser (Task 232)
 * Mirrors: vs/editor/common/model/textModelAutoIndentation.ts
 */

export const enum AutoIndent {
	None = 0,
	Keep = 1,
	Brackets = 2,
	Advanced = 3,
	Full = 4,
}

export interface IIndentRules {
	shouldIncreaseIndent(line: string): boolean;
	shouldDecreaseIndent(line: string): boolean;
	shouldIndentNextLine(line: string): boolean;
	shouldIgnoreInEmptyLine(line: string): boolean;
}

export interface IIndentRulePatterns {
	readonly increaseIndentPattern?: RegExp;
	readonly decreaseIndentPattern?: RegExp;
	readonly indentNextLinePattern?: RegExp;
	readonly unIndentedLinePattern?: RegExp;
}

export class IndentRules implements IIndentRules {
	private readonly _increase: RegExp | null;
	private readonly _decrease: RegExp | null;
	private readonly _indentNextLine: RegExp | null;
	private readonly _unIndented: RegExp | null;

	constructor(patterns: IIndentRulePatterns) {
		this._increase = patterns.increaseIndentPattern ?? null;
		this._decrease = patterns.decreaseIndentPattern ?? null;
		this._indentNextLine = patterns.indentNextLinePattern ?? null;
		this._unIndented = patterns.unIndentedLinePattern ?? null;
	}

	public shouldIncreaseIndent(line: string): boolean {
		if (!this._increase) {
			return false;
		}
		this._increase.lastIndex = 0;
		return this._increase.test(line);
	}

	public shouldDecreaseIndent(line: string): boolean {
		if (!this._decrease) {
			return false;
		}
		this._decrease.lastIndex = 0;
		return this._decrease.test(line);
	}

	public shouldIndentNextLine(line: string): boolean {
		if (!this._indentNextLine) {
			return false;
		}
		this._indentNextLine.lastIndex = 0;
		return this._indentNextLine.test(line);
	}

	public shouldIgnoreInEmptyLine(line: string): boolean {
		if (line.length === 0) {
			return true;
		}
		if (!this._unIndented) {
			return false;
		}
		this._unIndented.lastIndex = 0;
		return this._unIndented.test(line);
	}
}

export const DEFAULT_INDENT_RULES: IIndentRules = new IndentRules({
	increaseIndentPattern: /^\s*[({[\[].*$/,
	decreaseIndentPattern: /^\s*[)}\]]\s*(?:[;,.]|$)/,
	indentNextLinePattern: /^\s*(?:case|default|else|try|finally)\b[^:]*:|^\s*.*:\s*$/,
	unIndentedLinePattern: /^\s*(?:#|\/\/|\/\*|\*)/,

});


export function computeIndentRules(
	languageId: string,
	customRules: IIndentRulePatterns | null = null
): IIndentRules {
	if (customRules) {
		return new IndentRules(customRules);
	}
	return DEFAULT_INDENT_RULES;
}

export function computeAutoIndent(
	rules: IIndentRules,
	previousLine: string,
	currentLine: string
): number {
	let indentDelta = 0;
	if (rules.shouldDecreaseIndent(currentLine)) {
		indentDelta -= 1;
	}
	if (rules.shouldIncreaseIndent(previousLine)) {
		indentDelta += 1;
	}
	return indentDelta;
}

export function computeIndentLevel(line: string, tabSize: number): number {
	let result = 0;
	for (let i = 0; i < line.length; i++) {
		const ch = line.charCodeAt(i);
		if (ch === 32 /* space */) {
			result += 1;
		} else if (ch === 9 /* tab */) {
			result += tabSize - (result % tabSize);
		} else {
			break;
		}
	}
	return Math.floor(result / tabSize);
}

export interface IIndentationGuess {
	readonly insertSpaces: boolean;
	readonly tabSize: number;
}

export function guessIndentation(lines: readonly string[], fallbackTabSize = 4, fallbackInsertSpaces = true): IIndentationGuess {
	let tabIdentation = 0;
	let spaceIdentation = 0;
	let tabSizeSpaceMatches = 0;

	for (let i = 0; i < lines.length && i < 50; i++) {
		const line = lines[i];
		const indentation = line.match(/^\s+/);
		if (!indentation) {
			continue;
		}
		const indent = indentation[0];
		if (indent.indexOf('\t') !== -1) {
			tabIdentation += 1;
		} else if (indent.length > 0) {
			spaceIdentation += 1;
			for (const possibleTabSize of [2, 4, 8]) {
				if (indent.length % possibleTabSize === 0) {
					tabSizeSpaceMatches += 1;
				}
			}
		}
	}

	if (tabIdentation > 0 && tabIdentation >= spaceIdentation) {
		return { insertSpaces: false, tabSize: fallbackTabSize };
	}
	if (spaceIdentation > 0 && spaceIdentation > tabIdentation) {
		return { insertSpaces: true, tabSize: tabSizeSpaceMatches > 0 ? 2 : fallbackTabSize };
	}
	return { insertSpaces: fallbackInsertSpaces, tabSize: fallbackTabSize };
}
