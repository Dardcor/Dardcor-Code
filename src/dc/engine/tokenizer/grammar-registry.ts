import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IGrammarToken {
	readonly startIndex: number;
	readonly endIndex: number;
	readonly scopes: string[];
}

export interface IGrammarLineTokens {
	readonly lineNumber: number;
	readonly tokens: IGrammarToken[];
}

export interface IGrammar {
	readonly id: string;
	readonly name: string;
	tokenizeLine(lineText: string, state?: unknown): { tokens: IGrammarToken[]; state: unknown };
	containsLineBreak?(lineText: string): boolean;
}

const DEFAULT_RULES = [
	{ pattern: /\/\/[^\n]*$/g, scope: 'comment.line' },
	{ pattern: /\/\*[\s\S]*?\*\//g, scope: 'comment.block' },
	{ pattern: /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, scope: 'string.quoted' },
	{ pattern: /\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, scope: 'constant.numeric' },
	{ pattern: /\b(true|false|null|undefined|NaN|Infinity)\b/g, scope: 'constant.language' },
	{ pattern: /\b(?:function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|void|in|of|try|catch|finally|throw|yield|await|async|class|extends|super|import|from|export|default|const|let|var|static|this|arguments|get|set|private|protected|public|readonly|interface|type|enum|namespace|declare|abstract|implements|package|with|debugger)\b/g, scope: 'keyword' },
	{ pattern: /\b[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\()/g, scope: 'entity.name.function' },
];

const TYPE_COMMON_RULES = [
	...DEFAULT_RULES,
	{ pattern: /\b(?:string|number|boolean|any|unknown|never|void|symbol|bigint|object|Date|RegExp|Map|Set|Promise|Array|Error|Function)\b/g, scope: 'storage.type' },
];

const JSON_RULES = [
	{ pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/g, scope: 'support.type.property-name' },
	{ pattern: /"(?:\\.|[^"\\])*"/g, scope: 'string.quoted' },
	{ pattern: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, scope: 'constant.numeric' },
	{ pattern: /\b(?:true|false|null)\b/g, scope: 'constant.language' },
];

const HTML_RULES = [
	{ pattern: /<!--[\s\S]*?-->/g, scope: 'comment.block' },
	{ pattern: /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>)/g, scope: 'meta.tag' },
	{ pattern: /\b[A-Za-z-]+(?=\s*=\s*["'])/g, scope: 'entity.other.attribute-name' },
	{ pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, scope: 'string.quoted' },
];

const CSS_RULES = [
	{ pattern: /\/\*[\s\S]*?\*\//g, scope: 'comment.block' },
	{ pattern: /#[0-9a-fA-F]{3,8}\b/g, scope: 'constant.other.color' },
	{ pattern: /\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg|fr)?\b/g, scope: 'constant.numeric' },
	{ pattern: /[A-Za-z-]+(?=\s*:)/g, scope: 'support.type.property-name' },
	{ pattern: /^[^{}]+(?={)/gm, scope: 'entity.name.tag' },
	{ pattern: /\.[A-Za-z_-][A-Za-z0-9_-]*(?=[\s,{])/g, scope: 'entity.name.tag.class' },
];

const MARKDOWN_RULES = [
	{ pattern: /^#{1,6}\s.+$/gm, scope: 'markup.heading' },
	{ pattern: /^[>*+\-\s]*[*>-]/gm, scope: 'markup.list' },
	{ pattern: /`[^`]+`/g, scope: 'markup.inline.raw' },
	{ pattern: /^```[\s\S]*?^```$/gm, scope: 'markup.fenced_code.block' },
	{ pattern: /\[[^\]]*\]\([^)]*\)/g, scope: 'markup.underline.link' },
	{ pattern: /^\s*[-*_]{3,}\s*$/gm, scope: 'markup.bold' },
];

interface IGrammarRule {
	readonly pattern: RegExp;
	readonly scope: string;
}

class RuleBasedGrammar implements IGrammar {
	readonly id: string;
	readonly name: string;
	private readonly _rules: IGrammarRule[];

	constructor(id: string, name: string, rules: IGrammarRule[]) {
		this.id = id;
		this.name = name;
		this._rules = rules;
	}

	tokenizeLine(lineText: string, _state?: unknown): { tokens: IGrammarToken[]; state: unknown } {
		const tokens: IGrammarToken[] = [];
		for (const rule of this._rules) {
			rule.pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = rule.pattern.exec(lineText)) !== null) {
				tokens.push({
					startIndex: match.index,
					endIndex: match.index + match[0].length,
					scopes: [rule.scope],
				});
				if (match[0].length === 0) {
					rule.pattern.lastIndex++;
				}
			}
		}
		tokens.sort((a, b) => a.startIndex - b.startIndex);
		const merged: { startIndex: number; endIndex: number; scopes: string[] }[] = [];
		for (const token of tokens) {
			const previous = merged[merged.length - 1];
			if (previous && previous.endIndex >= token.startIndex) {
				if (previous.endIndex < token.endIndex) {
					previous.endIndex = token.endIndex;
					if (!previous.scopes.includes(token.scopes[0])) {
						previous.scopes.push(token.scopes[0]);
					}
				}
				continue;
			}
			merged.push({ startIndex: token.startIndex, endIndex: token.endIndex, scopes: token.scopes.slice() });
		}
		return { tokens: merged, state: undefined };
	}
}

class JavaScriptGrammar extends RuleBasedGrammar {
	constructor() {
		super('dc.typescript', 'TypeScript/JavaScript', TYPE_COMMON_RULES);
	}
}

class PythonGrammar implements IGrammar {
	readonly id = 'dc.python';
	readonly name = 'Python';
	private readonly _rules: IGrammarRule[] = [
		{ pattern: /#[^\n]*$/g, scope: 'comment.line' },
		{ pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''/g, scope: 'comment.block.documentation' },
		{ pattern: /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, scope: 'string.quoted' },
		{ pattern: /\b\d+(?:\.\d+)?j?\b/g, scope: 'constant.numeric' },
		{ pattern: /\b(?:True|False|None)\b/g, scope: 'constant.language' },
		{ pattern: /\b(?:def|class|return|if|elif|else|for|while|break|continue|import|from|as|with|try|except|finally|raise|lambda|yield|global|nonlocal|pass|del|assert|async|await|in|is|not|and|or|print)\b/g, scope: 'keyword' },
		{ pattern: /\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/g, scope: 'entity.name.function' },
	];
	private readonly _indentStack: number[] = [];

	tokenizeLine(lineText: string, state?: unknown): { tokens: IGrammarToken[]; state: unknown } {
		if (!lineText.trim()) {
			return { tokens: [], state };
		}
		const tokens: IGrammarToken[] = [];
		for (const rule of this._rules) {
			rule.pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = rule.pattern.exec(lineText)) !== null) {
				tokens.push({ startIndex: match.index, endIndex: match.index + match[0].length, scopes: [rule.scope] });
				if (match[0].length === 0) {
					rule.pattern.lastIndex++;
				}
			}
		}
		tokens.sort((a, b) => a.startIndex - b.startIndex);
		return { tokens, state };
	}
}

class MarkdownGrammar extends RuleBasedGrammar {
	constructor() {
		super('dc.markdown', 'Markdown', MARKDOWN_RULES);
	}
}

class HtmlGrammar extends RuleBasedGrammar {
	constructor() {
		super('dc.html', 'HTML', HTML_RULES);
	}
}

class CssGrammar extends RuleBasedGrammar {
	constructor() {
		super('dc.css', 'CSS', CSS_RULES);
	}
}

class JsonGrammar extends RuleBasedGrammar {
	constructor() {
		super('dc.json', 'JSON', JSON_RULES);
	}
}

class PlainTextGrammar implements IGrammar {
	readonly id = 'dc.plaintext';
	readonly name = 'Plain Text';
	tokenizeLine(_lineText: string): { tokens: IGrammarToken[]; state: unknown } {
		return { tokens: [], state: undefined };
	}
}

export class GrammarRegistry extends Disposable {
	private readonly _grammars = new Map<string, IGrammar>();
	private readonly _onDidAddGrammar = this._register(new Emitter<IGrammar>());
	readonly onDidAddGrammar: Event<IGrammar> = this._onDidAddGrammar.event;

	private readonly _plainText = new PlainTextGrammar();

	constructor() {
		super();
		this.register(new JavaScriptGrammar());
		this.register(new PythonGrammar());
		this.register(new MarkdownGrammar());
		this.register(new HtmlGrammar());
		this.register(new CssGrammar());
		this.register(new JsonGrammar());
		this.register(this._plainText);
	}

	public register(grammar: IGrammar): void {
		this._grammars.set(grammar.id, grammar);
		this._onDidAddGrammar.fire(grammar);
	}

	public unregister(id: string): boolean {
		return this._grammars.delete(id);
	}

	public getGrammar(id: string): IGrammar | undefined {
		return this._grammars.get(id);
	}

	public getGrammarById(id: string): IGrammar | undefined {
		return this._grammars.get(id);
	}

	public getGrammarForLanguageId(languageId: string): IGrammar {
		const candidates = [languageId.toLowerCase(), `dc.${languageId.toLowerCase()}`];
		for (const candidate of candidates) {
			const grammar = this._grammars.get(candidate);
			if (grammar) {
				return grammar;
			}
		}
		return this._plainText;
	}

	public getLanguageIdForFileName(fileName: string): string {
		const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
		switch (extension) {
			case 'ts': return 'typescript';
			case 'tsx': return 'typescript';
			case 'js': return 'javascript';
			case 'jsx': return 'javascript';
			case 'py': return 'python';
			case 'json': return 'json';
			case 'html': return 'html';
			case 'htm': return 'html';
			case 'css': return 'css';
			case 'md': return 'markdown';
			case 'markdown': return 'markdown';
			default: return 'plaintext';
		}
	}

	public getGrammarByFileName(fileName: string): IGrammar {
		return this.getGrammarForLanguageId(this.getLanguageIdForFileName(fileName));
	}

	public getRegisteredGrammars(): IGrammar[] {
		return Array.from(this._grammars.values());
	}

	public getGrammarIds(): string[] {
		return Array.from(this._grammars.keys());
	}

	public hasGrammar(id: string): boolean {
		return this._grammars.has(id);
	}

	public getGrammarCount(): number {
		return this._grammars.size;
	}
}
