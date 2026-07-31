/**
 * Dardcor Code - Code Action Provider Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IRange } from "../../model/text-model.js";
import { ICodeAction } from "./code-actions-menu.js";
import { CodeActionKind } from "./code-action-kind.js";

export type CodeActionTrigger = "manual" | "automatic";

export interface ICodeActionContext {
	readonly only?: CodeActionKind;
	readonly trigger: CodeActionTrigger;
}

export interface ICodeActionProvider {
	provideCodeActions(
		model: ITextModel,
		range: IRange,
		context: ICodeActionContext,
		token: CancellationToken
	): ICodeAction[] | null | Promise<ICodeAction[] | null>;
	resolveCodeAction?(action: ICodeAction): ICodeAction | null | Promise<ICodeAction | null>;
}

export class CodeActionProviderRegistry extends Disposable {
	private readonly _providers: ICodeActionProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: ICodeActionProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: ICodeActionProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly ICodeActionProvider[] {
		return this._providers;
	}

	public async provideCodeActions(model: ITextModel, range: IRange, context: ICodeActionContext): Promise<ICodeAction[]> {
		const results: ICodeAction[] = [];
		const seen = new Set<string>();
		for (const provider of this._providers) {
			try {
				const actions = await provider.provideCodeActions(model, range, context, CancellationToken.None);
				if (actions) {
					for (const action of actions) {
						if (context.only && action.kind && !context.only.intersects(action.kind)) {
							continue;
						}
						const key = `${action.title}@${action.kind?.value ?? ""}`;
						if (!seen.has(key)) {
							seen.add(key);
							results.push(action);
						}
					}
				}
			} catch {
				// A failing provider must not break the aggregation
			}
		}
		return results;
	}

	public async provideQuickFixes(model: ITextModel, range: IRange): Promise<ICodeAction[]> {
		return this.provideCodeActions(model, range, { trigger: "manual", only: CodeActionKind.QuickFix });
	}

	public async provideRefactors(model: ITextModel, range: IRange): Promise<ICodeAction[]> {
		return this.provideCodeActions(model, range, { trigger: "manual", only: CodeActionKind.Refactor });
	}

	public async resolveCodeAction(action: ICodeAction): Promise<ICodeAction | null> {
		for (const provider of this._providers) {
			const resolve = provider.resolveCodeAction;
			if (resolve) {
				try {
					const result = await resolve.call(provider, action);
					if (result) {
						return result;
					}
				} catch {
					// Try the next provider
				}
			}
		}
		return null;
	}
}

export type { ICodeAction } from "./code-actions-menu.js";
