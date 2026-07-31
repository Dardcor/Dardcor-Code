/**
 * Dardcor Code - Rename Symbol Provider Interface & Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { URI } from "../../../core/types/uri.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export interface IRenameLocation {
	readonly uri: URI;
	readonly range: IRange;
}

export interface IRenameEdit {
	readonly uri: URI;
	readonly range: IRange;
	readonly newText: string;
}

export interface IRenameEditsResult {
	readonly edits: readonly IRenameEdit[];
	readonly locations: readonly IRenameLocation[];
}

export interface IRenameProvider {
	provideRenameEdits(
		model: ITextModel,
		position: IPosition,
		newName: string,
		token: CancellationToken
	): IRenameEditsResult | null | Promise<IRenameEditsResult | null>;
}

export class RenameProviderRegistry extends Disposable {
	private readonly _providers: IRenameProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IRenameProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IRenameProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IRenameProvider[] {
		return this._providers;
	}

	public async provideRenameEdits(model: ITextModel, position: IPosition, newName: string): Promise<IRenameEditsResult | null> {
		for (const provider of this._providers) {
			try {
				const result = await provider.provideRenameEdits(model, position, newName, CancellationToken.None);
				if (result && result.edits.length > 0) {
					return result;
				}
			} catch {
				// Try the next provider
			}
		}
		return null;
	}

	public async canRename(model: ITextModel, position: IPosition): Promise<boolean> {
		const result = await this.provideRenameEdits(model, position, "_dc_can_rename_check_");
		return result !== null && result.edits.length > 0;
	}
}

export class SameFileRenameProvider implements IRenameProvider {
	public async provideRenameEdits(model: ITextModel, position: IPosition, newName: string, token: CancellationToken): Promise<IRenameEditsResult | null> {
		if (token.isCancellationRequested) {
			return null;
		}
		const wordRange = findWordRange(model, position);
		if (!wordRange) {
			return null;
		}
		const line = model.getLineContent(wordRange.startLineNumber);
		const oldName = line.substring(wordRange.startColumn - 1, wordRange.endColumn - 1);
		if (oldName.length === 0 || oldName === newName) {
			return null;
		}
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		const edits: IRenameEdit[] = [];
		const locations: IRenameLocation[] = [];
		const lineCount = model.getLineCount();
		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			const text = model.getLineContent(lineNumber);
			let index = 0;
			while (true) {
				const found = text.indexOf(oldName, index);
				if (found === -1) {
					break;
				}
				const beforeOk = found === 0 || !isWord(text[found - 1]);
				const afterOk = found + oldName.length >= text.length || !isWord(text[found + oldName.length]);
				if (beforeOk && afterOk) {
					const range: IRange = {
						startLineNumber: lineNumber,
						startColumn: found + 1,
						endLineNumber: lineNumber,
						endColumn: found + oldName.length + 1
					};
					edits.push({ uri: model.uri, range, newText: newName });
					locations.push({ uri: model.uri, range });
				}
				index = found + Math.max(1, oldName.length);
			}
		}
		return edits.length > 0 ? { edits, locations } : null;
	}
}

function findWordRange(model: ITextModel, position: IPosition): IRange | null {
	const line = model.getLineContent(position.lineNumber);
	const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
	if (!isWord(line[position.column - 1] ?? "")) {
		return null;
	}
	let start = position.column - 1;
	while (start > 0 && isWord(line[start - 1])) {
		start--;
	}
	let end = position.column;
	while (end < line.length && isWord(line[end])) {
		end++;
	}
	return { startLineNumber: position.lineNumber, startColumn: start + 1, endLineNumber: position.lineNumber, endColumn: end + 1 };
}
