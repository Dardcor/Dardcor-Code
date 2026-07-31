/**
 * Dardcor Code - Code Outline View Section Component Inside Sidebar
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode } from '../../core/dom/element.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { OutlineFilter } from './outline-filter.js';

export enum OutlineSymbolKind {
	Class = 0,
	Function = 1,
	Method = 2,
	Interface = 3,
	Type = 4,
	Enum = 5,
	Variable = 6,
	Constant = 7,
	Namespace = 8,
	Property = 9
}

export interface IOutlineSymbol {
	readonly name: string;
	readonly kind: OutlineSymbolKind;
	readonly line: number;
	readonly column: number;
	readonly depth: number;
}

export function getSymbolKindLabel(kind: OutlineSymbolKind): string {
	switch (kind) {
		case OutlineSymbolKind.Class: return 'Class';
		case OutlineSymbolKind.Function: return 'Function';
		case OutlineSymbolKind.Method: return 'Method';
		case OutlineSymbolKind.Interface: return 'Interface';
		case OutlineSymbolKind.Type: return 'Type';
		case OutlineSymbolKind.Enum: return 'Enum';
		case OutlineSymbolKind.Variable: return 'Variable';
		case OutlineSymbolKind.Constant: return 'Constant';
		case OutlineSymbolKind.Namespace: return 'Namespace';
		default: return 'Property';
	}
}

export function getSymbolKindIcon(kind: OutlineSymbolKind): string {
	switch (kind) {
		case OutlineSymbolKind.Class: return '\u25A6';
		case OutlineSymbolKind.Function: return '\u0192';
		case OutlineSymbolKind.Method: return '\u222A';
		case OutlineSymbolKind.Interface: return '\u25CB';
		case OutlineSymbolKind.Type: return '\u25B3';
		case OutlineSymbolKind.Enum: return '\u2588';
		case OutlineSymbolKind.Variable: return '\u2318';
		case OutlineSymbolKind.Constant: return '\u03BB';
		case OutlineSymbolKind.Namespace: return '\u229E';
		default: return '\u25AA';
	}
}

const CLASS_REGEX = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const INTERFACE_REGEX = /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/;
const ENUM_REGEX = /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_REGEX = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const TYPE_REGEX = /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/;
const METHOD_REGEX = /^(?:\s*)(?:public|private|protected|static|async|readonly|get|set|\*)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{:]/;
const VARIABLE_REGEX = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

export class OutlineParser {
	public static parse(source: string, languageId = 'typescript'): IOutlineSymbol[] {
		const lines = source.split(/\r?\n/);
		const symbols: IOutlineSymbol[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const depth = OutlineParser._measureDepth(line);
			const content = line.trim();
			if (!content || content.startsWith('//') || content.startsWith('/*') || content.startsWith('*')) {
				continue;
			}

			let match: RegExpMatchArray | null;
			if ((match = CLASS_REGEX.exec(content))) {
				symbols.push({ name: match[1], kind: OutlineSymbolKind.Class, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			} else if ((match = INTERFACE_REGEX.exec(content))) {
				symbols.push({ name: match[1], kind: OutlineSymbolKind.Interface, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			} else if ((match = ENUM_REGEX.exec(content))) {
				symbols.push({ name: match[1], kind: OutlineSymbolKind.Enum, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			} else if ((match = FUNCTION_REGEX.exec(content))) {
				symbols.push({ name: match[1], kind: OutlineSymbolKind.Function, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			} else if ((match = TYPE_REGEX.exec(content))) {
				symbols.push({ name: match[1], kind: OutlineSymbolKind.Type, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			} else if (depth > 0 && (match = METHOD_REGEX.exec(content))) {
				symbols.push({ name: match[1], kind: OutlineSymbolKind.Method, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			} else if ((match = VARIABLE_REGEX.exec(content))) {
				const isFunctionValue = /=>|function\s*\(/.test(content);
				const kind = isFunctionValue ? OutlineSymbolKind.Function : OutlineSymbolKind.Variable;
				symbols.push({ name: match[1], kind, line: i + 1, column: content.indexOf(match[1]) + 1, depth });
			}
		}
		return symbols;
	}

	private static _measureDepth(line: string): number {
		let depth = 0;
		for (const ch of line) {
			if (ch === '\t') {
				depth++;
			} else if (ch === ' ') {
				depth += 0.25;
			} else {
				break;
			}
		}
		return Math.round(depth);
	}
}

export class OutlineView extends Disposable {
	private readonly _onDidSelectSymbol = this._register(new Emitter<IOutlineSymbol>());
	readonly onDidSelectSymbol: Event<IOutlineSymbol> = this._onDidSelectSymbol.event;

	private readonly _onDidChangeDocument = this._register(new Emitter<URI>());
	readonly onDidChangeDocument: Event<URI> = this._onDidChangeDocument.event;

	private readonly _container: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _emptyLabel: HTMLElement;
	private readonly _filter: OutlineFilter;
	private _symbols: IOutlineSymbol[] = [];
	private _activeLine = -1;

	constructor(parentDom: HTMLElement, filter?: OutlineFilter) {
		super();
		this._filter = filter ?? new OutlineFilter();

		this._container = $<HTMLElement>('div', 'dc-outline-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		this._emptyLabel = $<HTMLElement>('div');
		this._emptyLabel.textContent = 'Tidak ada simbol. Buka file untuk melihat outline.';
		this._emptyLabel.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';

		this._listContainer = $<HTMLElement>('div', 'dc-outline-list');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);

		this._register(this._filter.onDidChange(() => this.render()));
	}

	get filter(): OutlineFilter {
		return this._filter;
	}

	public setDocument(uri: URI, source: string, languageId?: string): void {
		this._symbols = OutlineParser.parse(source, languageId);
		this.render();
	}

	public clear(): void {
		this._symbols = [];
		this.render();
	}

	public setActiveLine(line: number): void {
		this._activeLine = line;
		this.render();
	}

	public get symbols(): IOutlineSymbol[] {
		return this._symbols;
	}

	public render(): void {
		clearNode(this._listContainer);
		const symbols = this._filter.filter(this._symbols);

		if (symbols.length === 0) {
			const empty = $('div');
			empty.textContent = this._symbols.length === 0 ? this._emptyLabel.textContent ?? 'Tidak ada simbol.' : 'Tidak ada simbol yang cocok dengan filter.';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._listContainer.appendChild(empty);
			return;
		}

		for (const symbol of symbols) {
			const row = $<HTMLElement>('div', 'dc-outline-symbol');
			row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 8px;cursor:pointer;font-size:13px;user-select:none;';
			row.style.paddingLeft = `${8 + Math.min(symbol.depth, 12) * 14}px`;
			row.style.background = symbol.line === this._activeLine ? '#094771' : 'transparent';
			row.addEventListener('mouseenter', () => {
				if (symbol.line !== this._activeLine) {
					row.style.background = '#2a2d2e';
				}
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = symbol.line === this._activeLine ? '#094771' : 'transparent';
			});
			row.addEventListener('click', () => {
				this._onDidSelectSymbol.fire(symbol);
			});

			const icon = $<HTMLElement>('span');
			icon.textContent = getSymbolKindIcon(symbol.kind);
			icon.style.cssText = `font-size:11px;width:14px;text-align:center;color:${symbol.kind === OutlineSymbolKind.Class || symbol.kind === OutlineSymbolKind.Interface ? '#3794ff' : '#e5e510'};`;

			const name = $<HTMLElement>('span');
			name.textContent = symbol.name;
			name.style.cssText = 'color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
			name.title = `${symbol.name} \u2014 ${getSymbolKindLabel(symbol.kind)} (line ${symbol.line})`;

			const lineLabel = $<HTMLElement>('span');
			lineLabel.textContent = String(symbol.line);
			lineLabel.style.cssText = 'color:#6a6a6a;font-size:11px;';

			row.appendChild(icon);
			row.appendChild(name);
			row.appendChild(lineLabel);
			this._listContainer.appendChild(row);
		}
	}
}

export function getOutlineDocumentId(uri: URI): string {
	return `${uri.scheme}://${uri.authority}${Path.normalize(uri.path)}`;
}
