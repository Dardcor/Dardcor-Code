/**
 * Dardcor Code - VS Code Snippet Template Syntax Parser
 *
 * Supports: $1, ${1}, ${1:default}, ${1|a,b,c|}, $name, ${name},
 * ${name:default}, $$ (literal $), backslash escaping.
 */

export enum SnippetNodeKind {
	Text = "text",
	TabStop = "tabstop",
	Placeholder = "placeholder",
	Variable = "variable",
	Choice = "choice",
	EscapedText = "escaped"
}

export interface ISnippetNode {
	readonly kind: SnippetNodeKind;
	readonly offset: number;
	readonly length: number;
}

export interface ISnippetTextNode extends ISnippetNode {
	readonly kind: SnippetNodeKind.Text;
	readonly value: string;
}

export interface ISnippetTabStopNode extends ISnippetNode {
	readonly kind: SnippetNodeKind.TabStop;
	readonly index: number;
	readonly defaultValue?: string;
}

export interface ISnippetPlaceholderNode extends ISnippetNode {
	readonly kind: SnippetNodeKind.Placeholder;
	readonly index: number;
	readonly defaultValue: string;
	readonly innerNodes: ISnippetNode[];
}

export interface ISnippetVariableNode extends ISnippetNode {
	readonly kind: SnippetNodeKind.Variable;
	readonly name: string;
	readonly defaultValue?: string;
}

export interface ISnippetChoiceNode extends ISnippetNode {
	readonly kind: SnippetNodeKind.Choice;
	readonly index: number;
	readonly choices: string[];
}

export interface ISnippetEscapedTextNode extends ISnippetNode {
	readonly kind: SnippetNodeKind.EscapedText;
	readonly value: string;
}

export type SnippetNode = ISnippetTextNode | ISnippetTabStopNode | ISnippetPlaceholderNode | ISnippetVariableNode | ISnippetChoiceNode | ISnippetEscapedTextNode;

export interface ISnippetAST {
	readonly nodes: SnippetNode[];
	readonly text: string;
}

export interface ISnippetParseResult {
	readonly ast: ISnippetAST;
	readonly error: string | null;
}

function isVariableNameChar(ch: string): boolean {
	return /[A-Za-z0-9_]/.test(ch);
}

export class SnippetParser {
	private readonly _text: string;
	private _pos: number = 0;
	private _nodes: SnippetNode[] = [];

	constructor(text: string) {
		this._text = text;
	}

	public static parse(text: string): ISnippetParseResult {
		return new SnippetParser(text)._parse();
	}

	private _parse(): ISnippetParseResult {
		try {
			this._scan();
			const ast: ISnippetAST = { nodes: this._nodes, text: this._text };
			return { ast, error: null };
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			const ast: ISnippetAST = { nodes: [], text: this._text };
			return { ast, error };
		}
	}

	private _scan(): void {
		while (this._pos < this._text.length) {
			const ch = this._text[this._pos];
			if (ch === "\\") {
				this._scanEscape();
			} else if (ch === "$") {
				this._scanDollar();
			} else {
				this._scanText();
			}
		}
	}

	private _scanText(): void {
		const start = this._pos;
		while (this._pos < this._text.length && this._text[this._pos] !== "$" && this._text[this._pos] !== "\\") {
			this._pos++;
		}
		const value = this._text.substring(start, this._pos);
		this._nodes.push({ kind: SnippetNodeKind.Text, offset: start, length: value.length, value });
	}

	private _scanEscape(): void {
		const start = this._pos;
		this._pos++;
		if (this._pos >= this._text.length) {
			this._nodes.push({ kind: SnippetNodeKind.Text, offset: start, length: 1, value: "\\" });
			return;
		}
		const next = this._text[this._pos];
		this._pos++;
		this._nodes.push({ kind: SnippetNodeKind.EscapedText, offset: start, length: 2, value: next });
	}

	private _scanDollar(): void {
		const start = this._pos;
		this._pos++;
		if (this._pos >= this._text.length) {
			this._nodes.push({ kind: SnippetNodeKind.Text, offset: start, length: 1, value: "$" });
			return;
		}
		if (this._text[this._pos] === "$") {
			this._pos++;
			this._nodes.push({ kind: SnippetNodeKind.EscapedText, offset: start, length: 2, value: "$" });
			return;
		}
		if (this._text[this._pos] === "{") {
			this._scanBraced(start);
			return;
		}
		if (/\d/.test(this._text[this._pos])) {
			const indexStart = this._pos;
			while (this._pos < this._text.length && /\d/.test(this._text[this._pos])) {
				this._pos++;
			}
			const index = Number(this._text.substring(indexStart, this._pos));
			this._nodes.push({ kind: SnippetNodeKind.TabStop, offset: start, length: this._pos - start, index });
			return;
		}
		if (isVariableNameChar(this._text[this._pos])) {
			const nameStart = this._pos;
			while (this._pos < this._text.length && isVariableNameChar(this._text[this._pos])) {
				this._pos++;
			}
			const name = this._text.substring(nameStart, this._pos);
			this._nodes.push({ kind: SnippetNodeKind.Variable, offset: start, length: this._pos - start, name });
			return;
		}
		this._nodes.push({ kind: SnippetNodeKind.Text, offset: start, length: 1, value: "$" });
	}

	private _scanBraced(start: number): void {
		// at "{"
		this._pos++;
		if (this._pos >= this._text.length) {
			this._nodes.push({ kind: SnippetNodeKind.Text, offset: start, length: this._pos - start, value: this._text.substring(start) });
			this._pos = this._text.length;
			return;
		}
		if (this._text[this._pos] === "|") {
			this._scanChoice(start);
			return;
		}
		const nameStart = this._pos;
		while (this._pos < this._text.length && (isVariableNameChar(this._text[this._pos]))) {
			this._pos++;
		}
		if (this._pos === nameStart) {
			this._nodes.push({ kind: SnippetNodeKind.Text, offset: start, length: 1, value: "${" });
			return;
		}
		const name = this._text.substring(nameStart, this._pos);
		if (this._pos >= this._text.length) {
			throw new Error(`Invalid snippet: missing '}' after '${name}'`);
		}
		if (this._text[this._pos] === ":") {
			this._pos++;
			const defaultStart = this._pos;
			let closed = false;
			while (this._pos < this._text.length) {
				if (this._text[this._pos] === "}") {
					closed = true;
					break;
				}
				this._pos++;
			}
			if (!closed) {
				throw new Error(`Invalid snippet: missing '}' after '${name}'`);
			}
			const defaultValue = this._text.substring(defaultStart, this._pos);
			this._pos++;
			const isNumber = /^\d+$/.test(name);
			if (isNumber) {
				this._nodes.push({ kind: SnippetNodeKind.Placeholder, offset: start, length: this._pos - start, index: Number(name), defaultValue, innerNodes: [] });
			} else {
				this._nodes.push({ kind: SnippetNodeKind.Variable, offset: start, length: this._pos - start, name, defaultValue });
			}
			return;
		}
		if (this._text[this._pos] !== "}") {
			throw new Error(`Invalid snippet: missing '}' after '${name}'`);
		}
		this._pos++;
		const isNumber = /^\d+$/.test(name);
		if (isNumber) {
			const index = Number(name);
			this._nodes.push({ kind: SnippetNodeKind.TabStop, offset: start, length: this._pos - start, index });
		} else {
			this._nodes.push({ kind: SnippetNodeKind.Variable, offset: start, length: this._pos - start, name });
		}
	}

	private _scanChoice(start: number): void {
		// at "${"
		this._pos++; // past "|"
		const choices: string[] = [];
		let current = "";
		while (this._pos < this._text.length) {
			const ch = this._text[this._pos];
			if (ch === "|") {
				choices.push(current);
				current = "";
				this._pos++;
				if (this._pos >= this._text.length || this._text[this._pos] !== "}") {
					throw new Error("Invalid snippet: missing '}' in choice");
				}
				this._pos++;
				this._nodes.push({ kind: SnippetNodeKind.Choice, offset: start, length: this._pos - start, index: 1, choices });
				return;
			}
			if (ch === ",") {
				choices.push(current);
				current = "";
				this._pos++;
				continue;
			}
			current += ch;
			this._pos++;
		}
		throw new Error("Invalid snippet: unterminated choice");
	}
}

export function snippetNodesToText(nodes: readonly SnippetNode[]): string {
	let out = "";
	for (const node of nodes) {
		switch (node.kind) {
			case SnippetNodeKind.Text:
				out += node.value;
				break;
			case SnippetNodeKind.EscapedText:
				out += node.value;
				break;
			case SnippetNodeKind.TabStop:
				out += node.defaultValue ?? "";
				break;
			case SnippetNodeKind.Placeholder:
				out += node.defaultValue;
				break;
			case SnippetNodeKind.Variable:
				out += node.defaultValue ?? "";
				break;
			case SnippetNodeKind.Choice:
				out += node.choices[0] ?? "";
				break;
		}
	}
	return out;
}
