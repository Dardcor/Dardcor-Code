
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls';

export function parse(input: string, errors: YamlParseError[] = [], options: ParseOptions = {}): YamlNode | undefined {
	const scanner = new YamlScanner(input);
	const tokens = scanner.scan();
	const parser = new YamlParser(tokens, input, errors, options);
	return parser.parse();
}

export function parseFrontMatter(input: string, errors: YamlParseError[] = [], options: ParseOptions = {}): MarkdownNode | undefined {
	const tokens = new YamlScanner(input).scan();
	if (tokens.length === 0 || tokens[0].type !== TokenType.DocumentStart) {
		return new MarkdownNode(undefined, input);
	}
	const hasClosingFrontMatter = tokens.slice(1).some(token => token.type === TokenType.DocumentStart);
	if (!hasClosingFrontMatter) {
		return new MarkdownNode(undefined, input);
	}
	const header = new YamlParser(tokens, input, errors, options).parse();
	const lastToken = tokens[tokens.length - 1];
	const body = lastToken.type === TokenType.EOF ? input.substring(lastToken.startOffset) : '';
	return new MarkdownNode(header, body);
}

export class MarkdownNode {
	constructor(public readonly header: YamlNode | undefined, public readonly body: string) {
	}

	getStringValue(name: string): string | undefined {
		if (this.header && this.header.type === 'map') {
			const property = this.header.properties.find(p => p.key.value === name);
			if (property && property.value.type === 'scalar') {
				return property.value.value;
			}
		}
		return undefined;
	}

	getStringArrayValue(name: string): string[] | undefined {
		if (this.header && this.header.type === 'map') {
			const property = this.header.properties.find(p => p.key.value === name);
			if (property && property.value.type === 'sequence') {
				return property.value.items.filter(item => item.type === 'scalar').map(item => item.value);
			} else if (property && property.value.type === 'scalar' && property.value.format === 'none') {
				return parseCommaSeparatedList(property.value.value, 0).map(item => item.value);
			}
		}
		return undefined;
	}
}


export function parseCommaSeparatedList(value: string, offset: number = 0): YamlScalarNode[] {
	const parsed = parse(`[${value}]`);
	const shift = offset - 1;
	const items: YamlScalarNode[] = [];
	if (parsed && parsed.type === 'sequence') {
		for (const item of parsed.items) {
			if (item.type === 'scalar') {
				items.push({ ...item, startOffset: item.startOffset + shift, endOffset: item.endOffset + shift });
			}
		}
	} else {
		items.push({ type: 'scalar', value, rawValue: value, startOffset: offset, endOffset: value.length + offset, format: 'none' });
	}
	return items;
}


export interface YamlScalarNode {
	readonly type: 'scalar';
	readonly value: string;
	readonly rawValue: string;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly format: 'single' | 'double' | 'none' | 'literal' | 'folded';
}

export interface YamlMapNode {
	readonly type: 'map';
	readonly properties: { key: YamlScalarNode; value: YamlNode }[];
	readonly style: 'block' | 'flow';
	readonly startOffset: number;
	readonly endOffset: number;
}

export interface YamlSequenceNode {
	readonly type: 'sequence';
	readonly items: YamlNode[];
	readonly style: 'block' | 'flow';
	readonly startOffset: number;
	readonly endOffset: number;
}

export type YamlNode = YamlSequenceNode | YamlMapNode | YamlScalarNode;

export interface YamlParseError {
	readonly message: string;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly code: string;
}

export interface ParseOptions {
	readonly allowDuplicateKeys?: boolean;
}


const enum TokenType {
	Scalar,
	Colon,
	Dash,
	Comma,
	FlowMapStart,
	FlowMapEnd,
	FlowSeqStart,
	FlowSeqEnd,
	Newline,
	Indent,
	Comment,
	DocumentStart,
	DocumentEnd,
	EOF,
}

interface Token {
	readonly type: TokenType;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly rawValue: string;
	readonly value: string;
	readonly format: 'single' | 'double' | 'none' | 'literal' | 'folded';
	readonly indent: number;
}

function makeToken(
	type: TokenType,
	startOffset: number,
	endOffset: number,
	extra?: Partial<Pick<Token, 'rawValue' | 'value' | 'format' | 'indent'>>
): Token {
	return {
		type,
		startOffset,
		endOffset,
		rawValue: extra?.rawValue ?? '',
		value: extra?.value ?? '',
		format: extra?.format ?? 'none' as Token['format'],
		indent: extra?.indent ?? 0,
	};
}


class YamlScanner {
	private pos = 0;
	private readonly tokens: Token[] = [];
	private flowDepth = 0;
	private seenBlockColon = false;
	private seenDocumentStart = 0;

	constructor(private readonly input: string) { }

	scan(maxDocuments = 1): Token[] {
		while (this.pos < this.input.length) {
			this.scanLine();
			if (this.seenDocumentStart > maxDocuments) {
				break;
			}
		}
		this.tokens.push(makeToken(TokenType.EOF, this.pos, this.pos));
		return this.tokens;
	}

	private scanLine(): void {
		this.seenBlockColon = false;
		if (this.peekChar() === '\n') {
			this.tokens.push(makeToken(TokenType.Newline, this.pos, this.pos + 1));
			this.pos++;
			return;
		}
		if (this.peekChar() === '\r') {
			const end = this.pos + (this.input[this.pos + 1] === '\n' ? 2 : 1);
			this.tokens.push(makeToken(TokenType.Newline, this.pos, end));
			this.pos = end;
			return;
		}

		const indentStart = this.pos;
		let indent = 0;
		while (this.pos < this.input.length && (this.input[this.pos] === ' ' || this.input[this.pos] === '\t')) {
			indent++;
			this.pos++;
		}
		if (indent > 0) {
			this.tokens.push(makeToken(TokenType.Indent, indentStart, this.pos, { indent }));
		}

		if (this.pos >= this.input.length || this.peekChar() === '\n' || this.peekChar() === '\r') {
			if (this.pos < this.input.length) {
				const nlStart = this.pos;
				const end = this.peekChar() === '\r' && this.input[this.pos + 1] === '\n' ? this.pos + 2 : this.pos + 1;
				this.tokens.push(makeToken(TokenType.Newline, nlStart, end));
				this.pos = end;
			}
			return;
		}

		if (indent === 0 && this.input.length - this.pos >= 3) {
			const c0 = this.input[this.pos];
			const c1 = this.input[this.pos + 1];
			const c2 = this.input[this.pos + 2];
			const c3 = this.input[this.pos + 3];
			const isTerminator = c3 === undefined || c3 === ' ' || c3 === '\t' || c3 === '\n' || c3 === '\r';
			if (c0 === '-' && c1 === '-' && c2 === '-' && isTerminator) {
				this.tokens.push(makeToken(TokenType.DocumentStart, this.pos, this.pos + 3));
				this.pos += 3;
				this.scanLineContent();
				this.scanNewline();
				this.seenDocumentStart++;
				return;
			}
			if (c0 === '.' && c1 === '.' && c2 === '.' && isTerminator) {
				this.tokens.push(makeToken(TokenType.DocumentEnd, this.pos, this.pos + 3));
				this.pos += 3;
				this.scanLineContent();
				this.scanNewline();
				return;
			}
		}

		if (this.peekChar() === '#') {
			this.scanComment();
			this.scanNewline();
			return;
		}

		if (this.peekChar() === '%') {
			while (this.pos < this.input.length && this.input[this.pos] !== '\n' && this.input[this.pos] !== '\r') {
				this.pos++;
			}
			this.scanNewline();
			return;
		}

		this.scanLineContent();
		this.scanNewline();
	}

	private scanLineContent(): void {
		while (this.pos < this.input.length && this.peekChar() !== '\n' && this.peekChar() !== '\r') {
			this.skipInlineWhitespace();
			if (this.pos >= this.input.length || this.peekChar() === '\n' || this.peekChar() === '\r') {
				break;
			}

			const ch = this.peekChar();

			if (ch === '#') {
				this.scanComment();
				break;
			} else if (ch === '{') {
				this.flowDepth++;
				this.tokens.push(makeToken(TokenType.FlowMapStart, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === '}' && this.flowDepth > 0) {
				this.flowDepth--;
				this.tokens.push(makeToken(TokenType.FlowMapEnd, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === '[') {
				this.flowDepth++;
				this.tokens.push(makeToken(TokenType.FlowSeqStart, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === ']' && this.flowDepth > 0) {
				this.flowDepth--;
				this.tokens.push(makeToken(TokenType.FlowSeqEnd, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === ',' && this.flowDepth > 0) {
				this.tokens.push(makeToken(TokenType.Comma, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === '-' && this.isBlockDash()) {
				this.tokens.push(makeToken(TokenType.Dash, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === ':' && this.isBlockColon()) {
				this.tokens.push(makeToken(TokenType.Colon, this.pos, this.pos + 1));
				this.pos++;
				if (this.flowDepth === 0) {
					this.seenBlockColon = true;
				}
			} else if (ch === ':' && this.flowDepth > 0 && this.lastTokenIsJsonLike()) {
				this.tokens.push(makeToken(TokenType.Colon, this.pos, this.pos + 1));
				this.pos++;
			} else if (ch === '\'' || ch === '"') {
				this.scanQuotedScalar(ch);
			} else if ((ch === '|' || ch === '>') && this.flowDepth === 0 && this.isBlockScalarStart()) {
				this.scanBlockScalar(ch as '|' | '>');
				break;
			} else {
				this.scanUnquotedScalar();
			}
		}
	}

	private isBlockDash(): boolean {
		const next = this.input[this.pos + 1];
		return next === undefined || next === ' ' || next === '\t' || next === '\n' || next === '\r';
	}

	private isBlockColon(): boolean {
		if (this.seenBlockColon && this.flowDepth === 0) { return false; }
		const next = this.input[this.pos + 1];
		if (next === undefined || next === ' ' || next === '\t' || next === '\n' || next === '\r') { return true; }
		if (this.flowDepth > 0 && (next === ',' || next === '}' || next === ']')) { return true; }
		return false;
	}

	private lastTokenIsJsonLike(): boolean {
		for (let i = this.tokens.length - 1; i >= 0; i--) {
			const t = this.tokens[i];
			if (t.type === TokenType.Newline || t.type === TokenType.Indent || t.type === TokenType.Comment) {
				continue;
			}
			if (t.type === TokenType.Scalar && t.format !== 'none') { return true; }
			if (t.type === TokenType.FlowMapEnd || t.type === TokenType.FlowSeqEnd) { return true; }
			return false;
		}
		return false;
	}

	private scanQuotedScalar(quote: '\'' | '"'): void {
		const start = this.pos;
		this.pos++;
		let value = '';
		let trailingLiteralWs = 0;

		while (this.pos < this.input.length) {
			const ch = this.input[this.pos];
			if (ch === quote) {
				if (quote === '\'' && this.input[this.pos + 1] === '\'') {
					value += '\'';
					this.pos += 2;
					trailingLiteralWs = 0;
					continue;
				}
				this.pos++;
				const rawValue = this.input.substring(start, this.pos);
				this.tokens.push(makeToken(TokenType.Scalar, start, this.pos, {
					rawValue,
					value,
					format: quote === '\'' ? 'single' : 'double',
				}));
				return;
			}

			if (quote === '"' && ch === '\\') {
				const next = this.input[this.pos + 1];
				if (next === '\n' || next === '\r') {
					this.pos++;
					this.consumeNewline();
					this.skipInlineWhitespace();
					trailingLiteralWs = 0;
					continue;
				}
				switch (next) {
					case 'n': value += '\n'; break;
					case 't': value += '\t'; break;
					case '\\': value += '\\'; break;
					case '"': value += '"'; break;
					case '/': value += '/'; break;
					case 'r': value += '\r'; break;
					case '0': value += '\0'; break;
					case 'a': value += '\x07'; break;
					case 'b': value += '\b'; break;
					case 'e': value += '\x1b'; break;
					case 'v': value += '\v'; break;
					case 'f': value += '\f'; break;
					case ' ': value += ' '; break;
					case '_': value += '\xa0'; break;
					case 'x': {
						const hex = this.input.substring(this.pos + 2, this.pos + 4);
						const code = parseInt(hex, 16);
						if (hex.length === 2 && !isNaN(code)) {
							value += String.fromCharCode(code);
							this.pos += 4;
						} else {
							value += '\\x';
							this.pos += 2;
						}
						trailingLiteralWs = 0;
						continue;
					}
					case 'u': {
						const hex = this.input.substring(this.pos + 2, this.pos + 6);
						const code = parseInt(hex, 16);
						if (hex.length === 4 && !isNaN(code)) {
							value += String.fromCodePoint(code);
							this.pos += 6;
						} else {
							value += '\\u';
							this.pos += 2;
						}
						trailingLiteralWs = 0;
						continue;
					}
					case 'U': {
						const hex = this.input.substring(this.pos + 2, this.pos + 10);
						const code = parseInt(hex, 16);
						if (hex.length === 8 && !isNaN(code)) {
							value += String.fromCodePoint(code);
							this.pos += 10;
						} else {
							value += '\\U';
							this.pos += 2;
						}
						trailingLiteralWs = 0;
						continue;
					}
					default: value += '\\' + (next ?? ''); break;
				}
				this.pos += 2;
				trailingLiteralWs = 0;
				continue;
			}

			if (ch === '\n' || ch === '\r') {
				if (trailingLiteralWs > 0) {
					value = value.substring(0, value.length - trailingLiteralWs);
				}
				trailingLiteralWs = 0;

				this.consumeNewline();

				let emptyLineCount = 0;
				while (this.pos < this.input.length) {
					this.skipInlineWhitespace();
					const c = this.input[this.pos];
					if (c === '\n' || c === '\r') {
						emptyLineCount++;
						this.consumeNewline();
					} else {
						break;
					}
				}

				if (emptyLineCount > 0) {
					value += '\n'.repeat(emptyLineCount);
				} else {
					value += ' ';
				}
				continue;
			}

			if (ch === ' ' || ch === '\t') {
				trailingLiteralWs++;
			} else {
				trailingLiteralWs = 0;
			}
			value += ch;
			this.pos++;
		}

		const rawValue = this.input.substring(start, this.pos);
		this.tokens.push(makeToken(TokenType.Scalar, start, this.pos, {
			rawValue,
			value,
			format: quote === '\'' ? 'single' : 'double',
		}));
	}

	private scanUnquotedScalar(): void {
		const start = this.pos;
		let end = this.pos;

		while (this.pos < this.input.length) {
			const ch = this.input[this.pos];
			if (ch === '\n' || ch === '\r') { break; }
			if (this.flowDepth > 0 && (ch === ',' || ch === '}' || ch === ']')) { break; }
			if (this.flowDepth > 0 && (ch === '{' || ch === '[')) { break; }
			if (ch === ':' && this.isBlockColon()) { break; }
			if (ch === '#' && this.pos > start && (this.input[this.pos - 1] === ' ' || this.input[this.pos - 1] === '\t')) { break; }

			this.pos++;
			if (ch !== ' ' && ch !== '\t') {
				end = this.pos;
			}
		}

		const rawValue = this.input.substring(start, end);
		this.tokens.push(makeToken(TokenType.Scalar, start, end, {
			rawValue,
			value: rawValue,
			format: 'none',
		}));
	}

	private isBlockScalarStart(): boolean {
		let p = this.pos + 1;
		while (p < this.input.length) {
			const c = this.input[p];
			if (c >= '1' && c <= '9') { p++; continue; }
			if (c === '+' || c === '-') { p++; continue; }
			break;
		}
		while (p < this.input.length && (this.input[p] === ' ' || this.input[p] === '\t')) { p++; }
		if (p >= this.input.length) { return true; }
		const c = this.input[p];
		return c === '\n' || c === '\r' || c === '#';
	}

	private scanBlockScalar(style: '|' | '>'): void {
		const start = this.pos;
		this.pos++;

		let explicitIndent = 0;
		let chomping: 'clip' | 'strip' | 'keep' = 'clip';

		for (let i = 0; i < 2; i++) {
			if (this.pos < this.input.length) {
				const c = this.input[this.pos];
				if (c >= '1' && c <= '9' && explicitIndent === 0) {
					explicitIndent = parseInt(c, 10);
					this.pos++;
				} else if (c === '-' && chomping === 'clip') {
					chomping = 'strip';
					this.pos++;
				} else if (c === '+' && chomping === 'clip') {
					chomping = 'keep';
					this.pos++;
				}
			}
		}

		while (this.pos < this.input.length && (this.input[this.pos] === ' ' || this.input[this.pos] === '\t')) {
			this.pos++;
		}

		if (this.pos < this.input.length && this.input[this.pos] === '#') {
			while (this.pos < this.input.length && this.input[this.pos] !== '\n' && this.input[this.pos] !== '\r') {
				this.pos++;
			}
		}

		this.consumeNewline();

		const parentBlockIndent = this.getParentBlockIndent(start);

		let contentIndent = explicitIndent > 0 ? parentBlockIndent + explicitIndent : 0;
		const lines: string[] = [];
		let trailingNewlines = 0;

		while (this.pos < this.input.length) {
			const lineStart = this.pos;

			let lineIndent = 0;
			while (this.pos < this.input.length && this.input[this.pos] === ' ') {
				lineIndent++;
				this.pos++;
			}

			if (this.pos >= this.input.length || this.input[this.pos] === '\n' || this.input[this.pos] === '\r') {
				if (contentIndent > 0 && lineIndent >= contentIndent) {
					const preserved = this.input.substring(lineStart + contentIndent, this.pos);
					lines.push(preserved);
					if (preserved === '') {
						trailingNewlines++;
					} else {
						trailingNewlines = 0;
					}
				} else {
					lines.push('');
					trailingNewlines++;
				}
				this.consumeNewline();
				continue;
			}

			if (lineIndent === 0 && this.input.length - this.pos >= 3) {
				const c0 = this.input[this.pos];
				const c1 = this.input[this.pos + 1];
				const c2 = this.input[this.pos + 2];
				const c3 = this.input[this.pos + 3];
				const isTerm = c3 === undefined || c3 === ' ' || c3 === '\t' || c3 === '\n' || c3 === '\r';
				if ((c0 === '-' && c1 === '-' && c2 === '-' && isTerm) ||
					(c0 === '.' && c1 === '.' && c2 === '.' && isTerm)) {
					this.pos = lineStart;
					break;
				}
			}

			if (contentIndent === 0) {
				if (lineIndent <= parentBlockIndent) {
					this.pos = lineStart;
					break;
				}
				contentIndent = lineIndent;
			}

			if (lineIndent < contentIndent) {
				this.pos = lineStart;
				break;
			}

			const contentStart = lineStart + contentIndent;
			while (this.pos < this.input.length && this.input[this.pos] !== '\n' && this.input[this.pos] !== '\r') {
				this.pos++;
			}
			const lineContent = this.input.substring(contentStart, this.pos);
			lines.push(lineContent);
			trailingNewlines = 0;

			this.consumeNewline();
		}

		let value: string;
		if (style === '|') {
			value = lines.join('\n');
		} else {
			value = '';
			let lastNonEmptyIsMoreIndented = false;
			let inEmptyRun = false;
			let seenNonEmpty = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const isMoreIndented = line.length > 0 && (line[0] === ' ' || line[0] === '\t');

				if (line === '') {
					value += '\n';
					inEmptyRun = true;
				} else if (i === 0) {
					value = line;
					lastNonEmptyIsMoreIndented = isMoreIndented;
					seenNonEmpty = true;
				} else if (inEmptyRun) {
					if ((lastNonEmptyIsMoreIndented || isMoreIndented) && seenNonEmpty) {
						value += '\n' + line;
					} else {
						value += line;
					}
					lastNonEmptyIsMoreIndented = isMoreIndented;
					inEmptyRun = false;
					seenNonEmpty = true;
				} else if (isMoreIndented || lastNonEmptyIsMoreIndented) {
					value += '\n' + line;
					lastNonEmptyIsMoreIndented = isMoreIndented;
					seenNonEmpty = true;
				} else {
					value += ' ' + line;
					lastNonEmptyIsMoreIndented = false;
					seenNonEmpty = true;
				}
			}
		}

		if (trailingNewlines > 0) {
			let end = value.length;
			while (end > 0 && value[end - 1] === '\n') {
				end--;
			}
			value = value.substring(0, end);
		}

		const hasContent = lines.some(l => l !== '');

		switch (chomping) {
			case 'clip':
				if (hasContent) {
					value += '\n';
				}
				break;
			case 'keep':
				if (hasContent) {
					value += '\n'.repeat(trailingNewlines + 1);
				} else {
					value = '\n'.repeat(trailingNewlines);
				}
				break;
			case 'strip':
				break;
		}

		const rawValue = this.input.substring(start, this.pos);
		this.tokens.push(makeToken(TokenType.Scalar, start, this.pos, {
			rawValue,
			value,
			format: style === '|' ? 'literal' : 'folded',
		}));
	}

	private getParentBlockIndent(blockScalarPos: number): number {
		for (let i = this.tokens.length - 1; i >= 0; i--) {
			const t = this.tokens[i];
			if (t.type === TokenType.Newline || t.type === TokenType.Comment || t.type === TokenType.Indent) { continue; }
			if (t.type === TokenType.Colon) {
				for (let j = i - 1; j >= 0; j--) {
					const kt = this.tokens[j];
					if (kt.type === TokenType.Newline || kt.type === TokenType.Comment || kt.type === TokenType.Indent) { continue; }
					return this.getColumnAt(kt.startOffset);
				}
				return 0;
			}
			if (t.type === TokenType.Dash) {
				return this.getColumnAt(t.startOffset);
			}
			if (t.type === TokenType.DocumentStart) { return -1; }
			break;
		}
		return 0;
	}

	private getColumnAt(offset: number): number {
		let col = 0;
		let p = offset - 1;
		while (p >= 0 && this.input[p] !== '\n' && this.input[p] !== '\r') {
			col++;
			p--;
		}
		return col;
	}

	private scanComment(): void {
		const start = this.pos;
		while (this.pos < this.input.length && this.input[this.pos] !== '\n' && this.input[this.pos] !== '\r') {
			this.pos++;
		}
		this.tokens.push(makeToken(TokenType.Comment, start, this.pos, {
			rawValue: this.input.substring(start, this.pos),
			value: this.input.substring(start, this.pos),
		}));
	}

	private scanNewline(): void {
		const start = this.pos;
		if (this.consumeNewline()) {
			this.tokens.push(makeToken(TokenType.Newline, start, this.pos));
		}
	}

	private skipInlineWhitespace(): void {
		while (this.pos < this.input.length) {
			const ch = this.input[this.pos];
			if (ch === ' ' || ch === '\t') {
				this.pos++;
			} else {
				break;
			}
		}
	}

	private consumeNewline(): boolean {
		if (this.pos >= this.input.length) { return false; }
		if (this.input[this.pos] === '\r' && this.input[this.pos + 1] === '\n') {
			this.pos += 2;
			return true;
		}
		if (this.input[this.pos] === '\n' || this.input[this.pos] === '\r') {
			this.pos++;
			return true;
		}
		return false;
	}

	private peekChar(): string {
		return this.input[this.pos];
	}
}


class YamlParser {
	private pos = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly input: string,
		private readonly errors: YamlParseError[],
		private readonly options: ParseOptions,
	) { }

	parse(): YamlNode | undefined {
		this.skipNewlinesAndComments();
		if (this.currentToken().type === TokenType.DocumentStart) {
			this.advance();
			this.skipNewlinesAndComments();
		}
		if (this.currentToken().type === TokenType.EOF || this.currentToken().type === TokenType.DocumentEnd) {
			return undefined;
		}
		const result = this.parseValue(-1);
		return result;
	}


	private currentToken(): Token {
		return this.tokens[this.pos];
	}

	private peek(offset = 0): Token {
		return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
	}

	private advance(): Token {
		const t = this.tokens[this.pos];
		if (t.type !== TokenType.EOF) {
			this.pos++;
		}
		return t;
	}

	private expect(type: TokenType): Token {
		const t = this.currentToken();
		if (t.type === type) {
			return this.advance();
		}
		return t;
	}

	private emitError(message: string, startOffset: number, endOffset: number, code: string): void {
		this.errors.push({ message, startOffset, endOffset, code });
	}

	private skipNewlinesAndComments(): void {
		while (
			this.currentToken().type === TokenType.Newline ||
			this.currentToken().type === TokenType.Comment ||
			(this.currentToken().type === TokenType.Indent && this.isFollowedByNewlineOrComment())
		) {
			this.advance();
		}
	}

	private isFollowedByNewlineOrComment(): boolean {
		const next = this.peek(1);
		return next.type === TokenType.Newline || next.type === TokenType.Comment || next.type === TokenType.EOF;
	}

	private currentIndent(): number {
		if (this.currentToken().type === TokenType.Indent) {
			return this.currentToken().indent;
		}
		return 0;
	}


	private parseValue(parentIndent: number): YamlNode | undefined {
		this.skipNewlinesAndComments();
		const token = this.currentToken();

		const flowToken = token.type === TokenType.Indent ? this.peek(1) : token;
		if (flowToken.type === TokenType.FlowMapStart || flowToken.type === TokenType.FlowSeqStart) {
			if (token.type === TokenType.Indent) { this.advance(); }
			if (flowToken.type === TokenType.FlowMapStart) { return this.parseFlowMap(); }
			return this.parseFlowSeq();
		}

		const indent = this.currentIndent();

		const firstContentToken = this.peekPastIndent();

		if (firstContentToken.type === TokenType.Dash) {
			return this.parseBlockSequence(indent);
		}

		if (this.looksLikeMapping()) {
			return this.parseBlockMapping(indent);
		}

		if (token.type === TokenType.Scalar || token.type === TokenType.Indent) {
			return this.parseScalar(parentIndent);
		}

		return undefined;
	}

	private peekPastIndent(): Token {
		if (this.currentToken().type === TokenType.Indent) {
			return this.peek(1);
		}
		return this.currentToken();
	}

	private looksLikeMapping(): boolean {
		let offset = 0;
		if (this.peek(offset).type === TokenType.Indent) { offset++; }
		if (this.peek(offset).type === TokenType.Scalar) {
			offset++;
			if (this.peek(offset).type === TokenType.Colon) { return true; }
		}
		return false;
	}


	private parseScalar(parentIndent: number = -1): YamlScalarNode {
		if (this.currentToken().type === TokenType.Indent) {
			this.advance();
		}
		const token = this.expect(TokenType.Scalar);
		if (token.format !== 'none') {
			return this.scalarFromToken(token);
		}
		return this.parsePlainMultiline(token, parentIndent);
	}

	private parsePlainMultiline(firstToken: Token, parentIndent: number): YamlScalarNode {
		let value = firstToken.value;
		let endOffset = firstToken.endOffset;

		while (true) {
			const savedPos = this.pos;

			let emptyLineCount = 0;
			let foundContent = false;

			while (this.pos < this.tokens.length) {
				const t = this.currentToken();
				if (t.type === TokenType.Comment) {
					break;
				}
				if (t.type === TokenType.Newline) {
					this.advance();
					const afterNewline = this.currentToken();
					if (afterNewline.type === TokenType.Newline) {
						emptyLineCount++;
						continue;
					}
					if (afterNewline.type === TokenType.Indent) {
						const afterIndent = this.peek(1);
						if (afterIndent.type === TokenType.Newline || afterIndent.type === TokenType.EOF) {
							emptyLineCount++;
							this.advance();
							continue;
						}
						if (afterIndent.type === TokenType.Comment) {
							break;
						}
						if (afterNewline.indent > parentIndent) {
							foundContent = true;
							break;
						} else {
							break;
						}
					}
					if (afterNewline.type === TokenType.EOF) {
						break;
					}
					if (afterNewline.type === TokenType.DocumentStart || afterNewline.type === TokenType.DocumentEnd) {
						break;
					}
					if (parentIndent < 0) {
						foundContent = true;
						break;
					}
					break;
				}
				if (t.type === TokenType.Indent) {
					break;
				}
				break;
			}

			if (!foundContent) {
				this.pos = savedPos;
				break;
			}

			if (this.currentToken().type === TokenType.Indent) {
				this.advance();
			}

			if (this.currentToken().type !== TokenType.Scalar) {
				if (this.currentToken().type === TokenType.Dash) {
					const dashToken = this.advance();
					let lineText = '-';
					if (this.currentToken().type === TokenType.Scalar) {
						const restToken = this.advance();
						lineText = '- ' + restToken.value;
						endOffset = restToken.endOffset;
					} else {
						endOffset = dashToken.endOffset;
					}
					if (emptyLineCount > 0) {
						value += '\n'.repeat(emptyLineCount);
					} else {
						value += ' ';
					}
					value += lineText;
					continue;
				}
				this.pos = savedPos;
				break;
			}

			if (this.peek(1).type === TokenType.Colon) {
				this.pos = savedPos;
				break;
			}

			const contToken = this.advance();

			if (emptyLineCount > 0) {
				value += '\n'.repeat(emptyLineCount);
			} else {
				value += ' ';
			}
			value += contToken.value;
			endOffset = contToken.endOffset;
		}

		return {
			type: 'scalar',
			value,
			rawValue: this.input.substring(firstToken.startOffset, endOffset),
			startOffset: firstToken.startOffset,
			endOffset,
			format: 'none',
		};
	}


	private parseBlockMapping(baseIndent: number, inlineFirstEntry = false): YamlMapNode {
		const startOffset = this.currentToken().startOffset;
		const properties: { key: YamlScalarNode; value: YamlNode }[] = [];
		const seenKeys = new Set<string>();

		if (inlineFirstEntry) {
			const firstEntry = this.parseMappingEntry(baseIndent);
			if (firstEntry) {
				seenKeys.add(firstEntry.key.value);
				properties.push(firstEntry);
			}
		}

		while (this.currentToken().type !== TokenType.EOF) {
			this.skipNewlinesAndComments();
			if (this.currentToken().type === TokenType.EOF) { break; }

			const indent = this.currentIndent();
			if (indent < baseIndent) { break; }
			if (indent !== baseIndent) {
				if (indent > baseIndent) {
					this.emitError(
						localize('unexpectedIndentation', 'Unexpected indentation (expected {0}, got {1})', baseIndent, indent),
						this.currentToken().startOffset,
						this.currentToken().endOffset,
						'unexpected-indentation',
					);
				} else {
					break;
				}
			}
			if (!this.looksLikeMapping()) { break; }

			const entry = this.parseMappingEntry(baseIndent);
			if (!entry) { break; }

			if (!this.options.allowDuplicateKeys && seenKeys.has(entry.key.value)) {
				this.emitError(
					localize('duplicateKey', 'Duplicate key: "{0}"', entry.key.value),
					entry.key.startOffset,
					entry.key.endOffset,
					'duplicate-key',
				);
			}
			seenKeys.add(entry.key.value);
			properties.push(entry);
		}

		const endOffset = properties.length > 0 ? properties[properties.length - 1].value.endOffset : startOffset;
		return { type: 'map', properties, style: 'block', startOffset, endOffset };
	}

	private parseMappingEntry(baseIndent: number): { key: YamlScalarNode; value: YamlNode } | undefined {
		if (this.currentToken().type === TokenType.Indent) {
			this.advance();
		}

		const keyToken = this.expect(TokenType.Scalar);
		const key = this.scalarFromToken(keyToken);

		const colon = this.expect(TokenType.Colon);
		if (colon.type !== TokenType.Colon) {
			this.emitError(localize('expectedColon', 'Expected ":"'), colon.startOffset, colon.endOffset, 'expected-colon');
			return undefined;
		}

		const value = this.parseMappingValue(baseIndent, colon);

		return { key, value };
	}

	private parseMappingValue(baseIndent: number, colonToken: Token): YamlNode {
		const next = this.currentToken();

		if (next.type === TokenType.FlowMapStart) { return this.parseFlowMap(); }
		if (next.type === TokenType.FlowSeqStart) { return this.parseFlowSeq(); }

		if (next.type === TokenType.Scalar) {
			if (this.currentToken().type === TokenType.Indent) {
				this.advance();
			}
			const token = this.advance();
			if (token.format !== 'none') {
				return this.scalarFromToken(token);
			}
			return this.parsePlainMultiline(token, baseIndent);
		}

		this.skipNewlinesAndComments();
		const afterNewline = this.currentToken();

		if (afterNewline.type === TokenType.EOF) {
			this.emitError(localize('missingValue', 'Missing value'), colonToken.startOffset, colonToken.endOffset, 'missing-value');
			return this.makeEmptyScalar(colonToken.endOffset);
		}

		const nextIndent = this.currentIndent();

		if (nextIndent === baseIndent && this.peekPastIndent().type === TokenType.Dash) {
			return this.parseValue(baseIndent) ?? this.makeEmptyScalar(colonToken.endOffset);
		}

		if (nextIndent <= baseIndent) {
			this.emitError(localize('missingValue', 'Missing value'), colonToken.startOffset, colonToken.endOffset, 'missing-value');
			return this.makeEmptyScalar(colonToken.endOffset);
		}

		return this.parseValue(baseIndent) ?? this.makeEmptyScalar(colonToken.endOffset);
	}


	private parseBlockSequence(baseIndent: number): YamlSequenceNode {
		const items: YamlNode[] = [];
		const startOffset = this.currentToken().startOffset;
		let endOffset = startOffset;
		let isFirstItem = true;

		while (this.currentToken().type !== TokenType.EOF) {
			this.skipNewlinesAndComments();
			if (this.currentToken().type === TokenType.EOF) { break; }

			let indent: number;
			if (isFirstItem && this.currentToken().type === TokenType.Dash) {
				indent = this.currentToken().startOffset - this.getLineStart(this.currentToken().startOffset);
			} else {
				indent = this.currentIndent();
			}
			isFirstItem = false;

			if (indent < baseIndent) { break; }

			if (indent !== baseIndent) {
				if (indent > baseIndent) {
					this.emitError(
						localize('unexpectedIndentation', 'Unexpected indentation (expected {0}, got {1})', baseIndent, indent),
						this.currentToken().startOffset,
						this.currentToken().endOffset,
						'unexpected-indentation',
					);
				} else {
					break;
				}
			}

			const contentToken = this.peekPastIndent();
			if (contentToken.type !== TokenType.Dash) { break; }

			if (this.currentToken().type === TokenType.Indent) {
				this.advance();
			}

			const dashToken = this.advance();

			const itemValue = this.parseSequenceItemValue(baseIndent, dashToken);
			items.push(itemValue);
			endOffset = itemValue.endOffset;
		}

		return { type: 'sequence', items, style: 'block', startOffset, endOffset };
	}

	private parseSequenceItemValue(baseIndent: number, dashToken: Token): YamlNode {
		const next = this.currentToken();

		if (next.type === TokenType.Comment) {
			this.advance();
		}

		if (next.type === TokenType.FlowMapStart) { return this.parseFlowMap(); }
		if (next.type === TokenType.FlowSeqStart) { return this.parseFlowSeq(); }

		if (next.type === TokenType.Dash) {
			const nestedIndent = next.startOffset - this.getLineStart(next.startOffset);
			return this.parseBlockSequence(nestedIndent);
		}

		if (next.type === TokenType.Scalar) {
			if (this.peek(1).type === TokenType.Colon) {
				const itemIndent = next.startOffset - this.getLineStart(next.startOffset);
				return this.parseBlockMapping(itemIndent, true);
			}
			return this.parseScalar(baseIndent);
		}

		this.skipNewlinesAndComments();
		if (this.currentToken().type === TokenType.EOF) {
			this.emitError(localize('missingSeqItemValue', 'Missing sequence item value'), dashToken.startOffset, dashToken.endOffset, 'missing-value');
			return this.makeEmptyScalar(dashToken.endOffset);
		}

		const nextIndent = this.currentIndent();
		if (nextIndent <= baseIndent) {
			this.emitError(localize('missingSeqItemValue', 'Missing sequence item value'), dashToken.startOffset, dashToken.endOffset, 'missing-value');
			return this.makeEmptyScalar(dashToken.endOffset);
		}

		return this.parseValue(baseIndent) ?? this.makeEmptyScalar(dashToken.endOffset);
	}

	private getLineStart(offset: number): number {
		let i = offset - 1;
		while (i >= 0 && this.input[i] !== '\n' && this.input[i] !== '\r') {
			i--;
		}
		return i + 1;
	}


	private parseFlowMap(): YamlMapNode {
		const startToken = this.advance();
		const properties: { key: YamlScalarNode; value: YamlNode }[] = [];

		this.skipFlowWhitespace();

		while (this.currentToken().type !== TokenType.FlowMapEnd && this.currentToken().type !== TokenType.EOF) {
			let key: YamlScalarNode;
			if (this.currentToken().type === TokenType.Scalar) {
				key = this.parseFlowScalar();
			} else {
				this.emitError(localize('expectedMappingKey', 'Expected mapping key'), this.currentToken().startOffset, this.currentToken().endOffset, 'expected-key');
				break;
			}

			this.skipFlowWhitespace();

			let value: YamlNode;
			if (this.currentToken().type === TokenType.Colon) {
				this.advance();
				this.skipFlowWhitespace();

				value = this.parseFlowValue();
			} else {
				value = this.makeEmptyScalar(key.endOffset);
			}

			properties.push({ key, value });

			this.skipFlowWhitespace();

			if (this.currentToken().type === TokenType.Comma) {
				this.advance();
				this.skipFlowWhitespace();
			}
		}

		const endToken = this.currentToken();
		if (endToken.type === TokenType.FlowMapEnd) {
			this.advance();
		} else {
			this.emitError(localize('expectedFlowMapEnd', 'Expected "}"'), endToken.startOffset, endToken.endOffset, 'expected-flow-map-end');
		}

		return {
			type: 'map',
			properties,
			style: 'flow',
			startOffset: startToken.startOffset,
			endOffset: endToken.type === TokenType.FlowMapEnd ? endToken.endOffset : endToken.startOffset,
		};
	}


	private parseFlowSeq(): YamlSequenceNode {
		const startToken = this.advance();
		const items: YamlNode[] = [];

		this.skipFlowWhitespace();

		while (this.currentToken().type !== TokenType.FlowSeqEnd && this.currentToken().type !== TokenType.EOF) {
			let item: YamlNode;
			if (this.currentToken().type === TokenType.FlowMapStart) {
				item = this.parseFlowMap();
			} else if (this.currentToken().type === TokenType.FlowSeqStart) {
				item = this.parseFlowSeq();
			} else if (this.currentToken().type === TokenType.Scalar) {
				item = this.parseFlowScalar();
			} else {
				this.emitError(localize('unexpectedTokenInFlowSeq', 'Unexpected token in flow sequence'), this.currentToken().startOffset, this.currentToken().endOffset, 'unexpected-token');
				this.advance();
				continue;
			}

			items.push(item);
			this.skipFlowWhitespace();

			if (this.currentToken().type === TokenType.Comma) {
				this.advance();
				this.skipFlowWhitespace();
			}
		}

		const endToken = this.currentToken();
		if (endToken.type === TokenType.FlowSeqEnd) {
			this.advance();
		} else {
			this.emitError(localize('expectedFlowSeqEnd', 'Expected "]"'), endToken.startOffset, endToken.endOffset, 'expected-flow-seq-end');
		}

		return {
			type: 'sequence',
			items,
			style: 'flow',
			startOffset: startToken.startOffset,
			endOffset: endToken.type === TokenType.FlowSeqEnd ? endToken.endOffset : endToken.startOffset,
		};
	}

	private parseFlowScalar(): YamlScalarNode {
		const token = this.advance();
		if (token.format !== 'none') {
			return this.scalarFromToken(token);
		}
		let value = token.value;
		let endOffset = token.endOffset;

		while (true) {
			let hasNewline = false;
			let p = this.pos;
			while (p < this.tokens.length) {
				const t = this.tokens[p];
				if (t.type === TokenType.Newline) {
					hasNewline = true;
					p++;
				} else if (t.type === TokenType.Indent || t.type === TokenType.Comment) {
					p++;
				} else {
					break;
				}
			}

			if (!hasNewline || p >= this.tokens.length) { break; }

			const nextToken = this.tokens[p];
			if (nextToken.type === TokenType.Scalar && nextToken.format === 'none') {
				this.pos = p + 1;
				value += ' ' + nextToken.value;
				endOffset = nextToken.endOffset;
			} else {
				break;
			}
		}

		return {
			type: 'scalar',
			value,
			rawValue: this.input.substring(token.startOffset, endOffset),
			startOffset: token.startOffset,
			endOffset,
			format: 'none',
		};
	}

	private parseFlowValue(): YamlNode {
		if (this.currentToken().type === TokenType.FlowMapStart) {
			return this.parseFlowMap();
		} else if (this.currentToken().type === TokenType.FlowSeqStart) {
			return this.parseFlowSeq();
		} else if (this.currentToken().type === TokenType.Scalar) {
			return this.parseFlowScalar();
		} else {
			return this.makeEmptyScalar(this.currentToken().startOffset);
		}
	}

	private skipFlowWhitespace(): void {
		while (true) {
			const t = this.currentToken().type;
			if (t === TokenType.Newline || t === TokenType.Indent || t === TokenType.Comment) {
				this.advance();
			} else {
				break;
			}
		}
	}

	private scalarFromToken(token: Token): YamlScalarNode {
		return {
			type: 'scalar',
			value: token.value,
			rawValue: token.rawValue,
			startOffset: token.startOffset,
			endOffset: token.endOffset,
			format: token.format,
		};
	}

	private makeEmptyScalar(offset: number): YamlScalarNode {
		return {
			type: 'scalar',
			value: '',
			rawValue: '',
			startOffset: offset,
			endOffset: offset,
			format: 'none',
		};
	}
}
