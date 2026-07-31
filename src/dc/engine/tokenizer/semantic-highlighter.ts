/**
 * Dardcor Code - LSP Semantic Token Delta Merger (Task 259)
 * Mirrors: vs/editor/common/model/semanticTokens/semanticTokens.ts
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface ISemanticToken {
	readonly lineNumber: number;
	readonly startColumn: number;
	readonly length: number;
	readonly type: string;
	readonly modifiers?: readonly string[];
}

export interface ISemanticTokens {
	readonly resultId?: string;
	readonly data: readonly number[];
}

export interface ISemanticTokensEdit {
	readonly start: number;
	readonly deleteCount: number;
	readonly data?: readonly number[];
}

export interface ISemanticTokensEdits {
	readonly resultId?: string;
	readonly edits: readonly ISemanticTokensEdit[];
}

export interface ISemanticHighlightEvent {
	readonly lineNumber: number;
	readonly tokens: readonly ISemanticToken[];
}

const LEGEND_OFFSET = 3; // line, column, length, typeIndex, modifierBitset

export class SemanticHighlighter extends Disposable {
	private readonly _tokensByLine = new Map<number, ISemanticToken[]>();
	private _fullTokens: ISemanticToken[] = [];
	private _resultId: string | undefined;

	private readonly _onDidChangeSemanticTokens = this._register(new Emitter<ISemanticHighlightEvent>());
	readonly onDidChangeSemanticTokens: Event<ISemanticHighlightEvent> = this._onDidChangeSemanticTokens.event;

	constructor(
		private readonly _tokenTypeLegend: readonly string[] = [],
		private readonly _tokenModifierLegend: readonly string[] = []
	) {
		super();
	}

	public applyTokens(tokens: ISemanticToken[]): void {
		this._fullTokens = [...tokens];
		this._rebuildIndex();
		this._fireAll();
	}

	public applyEncoded(tokens: ISemanticTokens): void {
		this._resultId = tokens.resultId;
		this.applyTokens(SemanticHighlighter.decode(tokens.data, this._tokenTypeLegend, this._tokenModifierLegend));
	}

	public applyDelta(previousResultId: string | undefined, delta: ISemanticTokensEdits): void {
		if (this._resultId !== undefined && previousResultId !== undefined && this._resultId === previousResultId) {
			for (const edit of delta.edits) {
				this._fullTokens.splice(edit.start, edit.deleteCount, ...SemanticHighlighter.decode(edit.data ?? [], this._tokenTypeLegend, this._tokenModifierLegend));
			}
			this._resultId = delta.resultId;
			this._rebuildIndex();
			this._fireAll();
		} else {
			throw new Error('Semantic token delta applied with mismatched result id');
		}
	}

	public getTokensForLine(lineNumber: number): ISemanticToken[] {
		return this._tokensByLine.get(lineNumber) ?? [];
	}

	public clearRange(startLine: number, endLine: number): void {
		this._fullTokens = this._fullTokens.filter((t) => t.lineNumber < startLine || t.lineNumber > endLine);
		for (let line = startLine; line <= endLine; line++) {
			this._tokensByLine.delete(line);
		}
	}

	public clearAll(): void {
		this._fullTokens = [];
		this._tokensByLine.clear();
	}

	public getFullTokens(): ISemanticToken[] {
		return [...this._fullTokens];
	}

	public getResultId(): string | undefined {
		return this._resultId;
	}

	public getTokenTypeLegend(): readonly string[] {
		return this._tokenTypeLegend;
	}

	private _rebuildIndex(): void {
		this._tokensByLine.clear();
		for (const token of this._fullTokens) {
			let list = this._tokensByLine.get(token.lineNumber);
			if (!list) {
				list = [];
				this._tokensByLine.set(token.lineNumber, list);
			}
			list.push(token);
		}
		for (const list of this._tokensByLine.values()) {
			list.sort((a, b) => a.startColumn - b.startColumn);
		}
	}

	private _fireAll(): void {
		for (const [lineNumber, tokens] of this._tokensByLine) {
			this._onDidChangeSemanticTokens.fire({ lineNumber, tokens });
		}
	}

	public static decode(
		data: readonly number[],
		typeLegend: readonly string[],
		modifierLegend: readonly string[]
	): ISemanticToken[] {
		const tokens: ISemanticToken[] = [];
		let prevLine = 0;
		let prevColumn = 0;
		for (let i = 0; i + LEGEND_OFFSET <= data.length; i += LEGEND_OFFSET) {
			const lineDelta = data[i];
			const columnDelta = data[i + 1];
			const length = data[i + 2];
			const typeIndex = data[i + 3];
			const modifierBitset = data[i + 4] ?? 0;

			prevLine = lineDelta > 0 ? prevLine + lineDelta : prevLine;
			prevColumn = lineDelta > 0 ? 1 : prevColumn + columnDelta;
			const startColumn = prevColumn;

			const type = typeLegend[typeIndex] ?? '';
			const modifiers: string[] = [];
			for (let m = 0; m < modifierLegend.length; m++) {
				if ((modifierBitset & (1 << m)) !== 0) {
					modifiers.push(modifierLegend[m]);
				}
			}

			tokens.push({
				lineNumber: prevLine,
				startColumn,
				length,
				type,
				modifiers,
			});
			prevColumn += length;
		}
		return tokens;
	}

	public static encode(tokens: readonly ISemanticToken[], typeLegend: readonly string[], modifierLegend: readonly string[]): number[] {
		const data: number[] = [];
		let prevLine = 0;
		let prevColumn = 0;
		for (const token of tokens) {
			const lineDelta = token.lineNumber - prevLine;
			const columnDelta = lineDelta > 0 ? token.startColumn - 1 : token.startColumn - prevColumn;
			let modifierBitset = 0;
			for (const modifier of token.modifiers ?? []) {
				const index = modifierLegend.indexOf(modifier);
				if (index !== -1) {
					modifierBitset |= 1 << index;
				}
			}
			data.push(lineDelta, columnDelta, token.length, Math.max(0, typeLegend.indexOf(token.type)), modifierBitset);
			prevLine = token.lineNumber;
			prevColumn = token.startColumn + token.length;
		}
		return data;
	}
}
