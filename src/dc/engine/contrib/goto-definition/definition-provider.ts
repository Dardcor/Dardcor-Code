/**
 * Dardcor Code - Definition Provider Registry Interface
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { IDefinitionLink, IDefinitionContext, IDefinitionProvider } from "./goto-definition.js";

export class DefinitionProviderRegistry extends Disposable {
	private readonly _providers: IDefinitionProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IDefinitionProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IDefinitionProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IDefinitionProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async findDefinitions(model: ITextModel, position: IPosition, context: IDefinitionContext = { includeDeclaration: true }): Promise<IDefinitionLink[]> {
		const results: IDefinitionLink[] = [];
		for (const provider of this._providers) {
			try {
				const links = await provider.provideDefinition(model, position, context, CancellationToken.None);
				if (links) {
					results.push(...links);
				}
			} catch {
				// A failing provider must not break the lookup
			}
		}
		return results;
	}

	public async findFirstDefinition(model: ITextModel, position: IPosition): Promise<IDefinitionLink | null> {
		const links = await this.findDefinitions(model, position);
		return links.length > 0 ? links[0] : null;
	}
}

export class WordMatchDefinitionProvider implements IDefinitionProvider {
	public async provideDefinition(model: ITextModel, position: IPosition, context: IDefinitionContext, token: CancellationToken): Promise<IDefinitionLink[]> {
		const wordRange = findWordRange(model, position);
		if (!wordRange) {
			return [];
		}
		const line = model.getLineContent(wordRange.startLineNumber);
		const word = line.substring(wordRange.startColumn - 1, wordRange.endColumn - 1);
		if (word.length === 0) {
			return [];
		}
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		const lineCount = model.getLineCount();
		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			const text = model.getLineContent(lineNumber);
			let index = 0;
			while (true) {
				const found = text.indexOf(word, index);
				if (found === -1) {
					break;
				}
				const beforeOk = found === 0 || !isWord(text[found - 1]);
				const afterOk = found + word.length >= text.length || !isWord(text[found + word.length]);
				if (beforeOk && afterOk) {
					const candidate: IRange = {
						startLineNumber: lineNumber,
						startColumn: found + 1,
						endLineNumber: lineNumber,
						endColumn: found + word.length + 1
					};
					if (candidate.startLineNumber !== wordRange.startLineNumber || candidate.startColumn !== wordRange.startColumn) {
						return [{
							uri: model.uri,
							range: candidate,
							originRange: wordRange
						}];
					}
				}
				index = found + Math.max(1, word.length);
			}
		}
		return [];
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
