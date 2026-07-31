/**
 * Dardcor Code - Link Resolution Provider Interface & Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel } from "../../model/text-model.js";
import { ILink } from "./links-controller.js";
import { LinkDetector } from "./link-detector.js";

export interface ILinkContext {
	readonly enabled: boolean;
}

export interface ILinkProvider {
	provideLinks(model: ITextModel, context: ILinkContext, token: CancellationToken): ILink[] | null | Promise<ILink[] | null>;
}

export class LinkProviderRegistry extends Disposable {
	private readonly _providers: ILinkProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: ILinkProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: ILinkProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly ILinkProvider[] {
		return this._providers;
	}

	public async provideLinks(model: ITextModel, context: ILinkContext = { enabled: true }): Promise<ILink[]> {
		const results: ILink[] = [];
		const seen = new Set<string>();
		for (const provider of this._providers) {
			try {
				const links = await provider.provideLinks(model, context, CancellationToken.None);
				if (links) {
					for (const link of links) {
						const key = `${link.url}@${link.range.startLineNumber}:${link.range.startColumn}`;
						if (!seen.has(key)) {
							seen.add(key);
							results.push(link);
						}
					}
				}
			} catch {
				// A failing provider must not break the aggregation
			}
		}
		results.sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
		return results;
	}
}

export class DetectedLinkProvider implements ILinkProvider {
	public async provideLinks(model: ITextModel, context: ILinkContext, token: CancellationToken): Promise<ILink[]> {
		if (token.isCancellationRequested || !context.enabled) {
			return [];
		}
		const detected = LinkDetector.detectModel(model);
		return detected.map(d => ({
			range: d.range,
			url: d.url,
			tooltip: d.tooltip
		}));
	}
}

export type { ILink } from "./links-controller.js";
