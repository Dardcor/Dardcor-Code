/**
 * Dardcor Code - Document & Range Code Formatter Runner
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export interface IFormattingOptions {
	readonly tabSize: number;
	readonly insertSpaces: boolean;
}

export interface IFormattingEdit {
	readonly range: IRange;
	readonly text: string;
}

export interface IFormatProvider {
	provideDocumentFormattingEdits(
		model: ITextModel,
		options: IFormattingOptions,
		token: CancellationToken
	): IFormattingEdit[] | null | Promise<IFormattingEdit[] | null>;
	provideRangeFormattingEdits?(
		model: ITextModel,
		range: IRange,
		options: IFormattingOptions,
		token: CancellationToken
	): IFormattingEdit[] | null | Promise<IFormattingEdit[] | null>;
}

export class FormatController extends Disposable {
	private readonly _providers: IFormatProvider[] = [];
	private _isFormatting: boolean = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidFormat = this._register(new Emitter<{ edits: number }>());
	readonly onDidFormat: Event<{ edits: number }> = this._onDidFormat.event;

	public registerProvider(provider: IFormatProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: IFormatProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public async formatDocument(model: ITextModel, options: IFormattingOptions = { tabSize: 4, insertSpaces: true }): Promise<boolean> {
		if (this._isFormatting || this._providers.length === 0) {
			return false;
		}
		this._isFormatting = true;
		try {
			const edits = await this._collectEdits(provider =>
				provider.provideDocumentFormattingEdits(model, options, CancellationToken.None)
			);
			this.applyEdits(model, edits);
			if (edits.length > 0) {
				this._onDidFormat.fire({ edits: edits.length });
			}
			return edits.length > 0;
		} finally {
			this._isFormatting = false;
		}
	}

	public async formatRange(model: ITextModel, range: IRange, options: IFormattingOptions = { tabSize: 4, insertSpaces: true }): Promise<boolean> {
		if (this._isFormatting || this._providers.length === 0) {
			return false;
		}
		this._isFormatting = true;
		try {
			const edits = await this._collectEdits(provider => {
				const fn = provider.provideRangeFormattingEdits;
				return fn ? fn.call(provider, model, range, options, CancellationToken.None) : null;
			});
			this.applyEdits(model, edits);
			if (edits.length > 0) {
				this._onDidFormat.fire({ edits: edits.length });
			}
			return edits.length > 0;
		} finally {
			this._isFormatting = false;
		}
	}

	private async _collectEdits(fn: (provider: IFormatProvider) => IFormattingEdit[] | null | Promise<IFormattingEdit[] | null>): Promise<IFormattingEdit[]> {
		for (const provider of this._providers) {
			try {
				const edits = await fn(provider);
				if (edits && edits.length > 0) {
					return edits;
				}
			} catch {
				// Try the next provider
			}
		}
		return [];
	}

	public applyEdits(model: ITextModel, edits: IFormattingEdit[]): void {
		if (edits.length === 0) {
			return;
		}
		const offsets = this._computeLineOffsets(model);
		const sorted = [...edits].sort((a, b) => {
			const aStart = this._offsetAt(offsets, a.range.startLineNumber, a.range.startColumn);
			const bStart = this._offsetAt(offsets, b.range.startLineNumber, b.range.startColumn);
			return bStart - aStart;
		});
		const text = model.getValue();
		let result = text;
		for (const edit of sorted) {
			const start = this._offsetAt(offsets, edit.range.startLineNumber, edit.range.startColumn);
			const end = this._offsetAt(offsets, edit.range.endLineNumber, edit.range.endColumn);
			if (start < 0 || end < start || end > result.length) {
				continue;
			}
			result = result.substring(0, start) + edit.text + result.substring(end);
		}
		if (result !== text) {
			model.setValue(result);
		}
		this._onDidChange.fire();
	}

	private _computeLineOffsets(model: ITextModel): number[] {
		const offsets: number[] = [0];
		for (let line = 1; line <= model.getLineCount(); line++) {
			offsets.push(offsets[offsets.length - 1] + model.getLineContent(line).length + 1);
		}
		return offsets;
	}

	private _offsetAt(offsets: number[], lineNumber: number, column: number): number {
		if (lineNumber < 1 || lineNumber >= offsets.length) {
			return -1;
		}
		return offsets[lineNumber - 1] + (column - 1);
	}

	public isFormatting(): boolean {
		return this._isFormatting;
	}

	public getProviders(): readonly IFormatProvider[] {
		return this._providers;
	}
}
