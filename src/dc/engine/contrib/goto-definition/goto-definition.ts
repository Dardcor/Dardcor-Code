/**
 * Dardcor Code - Jump To Definition Provider Bridge
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { URI } from "../../../core/types/uri.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export interface IDefinitionLink {
	readonly uri: URI;
	readonly range: IRange;
	readonly originRange?: IRange;
}

export interface IDefinitionContext {
	readonly includeDeclaration: boolean;
}

export interface IDefinitionProvider {
	provideDefinition(
		model: ITextModel,
		position: IPosition,
		context: IDefinitionContext,
		token: CancellationToken
	): IDefinitionLink[] | null | Promise<IDefinitionLink[] | null>;
}

export interface IGotoDefinitionHost {
	revealRange(range: IRange): void;
	setSelection(range: IRange): void;
}

export class GotoDefinition extends Disposable {
	private readonly _providers: IDefinitionProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidNavigate = this._register(new Emitter<IDefinitionLink>());
	readonly onDidNavigate: Event<IDefinitionLink> = this._onDidNavigate.event;

	public registerProvider(provider: IDefinitionProvider): void {
		this._providers.push(provider);
		this._onDidChange.fire();
	}

	public unregisterProvider(provider: IDefinitionProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public async findDefinition(model: ITextModel, position: IPosition): Promise<IDefinitionLink | null> {
		const context: IDefinitionContext = { includeDeclaration: true };
		for (const provider of this._providers) {
			try {
				const result = await provider.provideDefinition(model, position, context, CancellationToken.None);
				if (result && result.length > 0) {
					return result[0];
				}
			} catch {
				// Try the next provider
			}
		}
		return null;
	}

	public async goto(model: ITextModel, position: IPosition, host: IGotoDefinitionHost): Promise<IDefinitionLink | null> {
		const link = await this.findDefinition(model, position);
		if (link) {
			host.revealRange(link.range);
			host.setSelection(link.range);
			this._onDidNavigate.fire(link);
		}
		return link;
	}

	public findWordAtPosition(model: ITextModel, position: IPosition): IRange | null {
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

	public getProviders(): readonly IDefinitionProvider[] {
		return this._providers;
	}
}
