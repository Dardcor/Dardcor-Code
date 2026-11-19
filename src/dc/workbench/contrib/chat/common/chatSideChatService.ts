/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { derived, IObservable, observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IChatSideChatSelection {
	readonly text: string;
}

export interface IChatSideChatOrigin {
	readonly sourceSessionResource: URI;
	readonly sourceTurnId: string;
	readonly sourceTitle: string | undefined;
	readonly selection?: IChatSideChatSelection;
}

export interface IChatSideChatProvider {
	canAskInSideChat(sessionResource: URI): boolean;

	askInSideChat(sessionResource: URI, query: string, selection?: IChatSideChatSelection): Promise<void>;

	observeSideChatOrigin(sessionResource: URI): IObservable<IChatSideChatOrigin | undefined>;

	revealSideChatSource(sessionResource: URI): Promise<void>;
}

export const IChatSideChatService = createDecorator<IChatSideChatService>('chatSideChatService');

export interface IChatSideChatService {
	readonly _serviceBrand: undefined;

	registerProvider(provider: IChatSideChatProvider): IDisposable;

	canAskInSideChat(sessionResource: URI): boolean;

	askInSideChat(sessionResource: URI, query: string, selection?: IChatSideChatSelection): Promise<void>;

	observeSideChatOrigin(sessionResource: URI): IObservable<IChatSideChatOrigin | undefined>;

	revealSideChatSource(sessionResource: URI): Promise<void>;
}

export class ChatSideChatService extends Disposable implements IChatSideChatService {

	declare readonly _serviceBrand: undefined;

	private readonly _providers = observableValue<readonly IChatSideChatProvider[]>(this, []);
	private readonly _sideChatOrigins = new ResourceMap<IObservable<IChatSideChatOrigin | undefined>>();

	registerProvider(provider: IChatSideChatProvider): IDisposable {
		if (!this._providers.get().includes(provider)) {
			this._providers.set([...this._providers.get(), provider], undefined);
		}

		return toDisposable(() => {
			const providers = this._providers.get();
			const index = providers.indexOf(provider);
			if (index !== -1) {
				this._providers.set([...providers.slice(0, index), ...providers.slice(index + 1)], undefined);
			}
		});
	}

	canAskInSideChat(sessionResource: URI): boolean {
		return !!this._findProvider(sessionResource);
	}

	async askInSideChat(sessionResource: URI, query: string, selection?: IChatSideChatSelection): Promise<void> {
		const provider = this._findProvider(sessionResource);
		if (!provider) {
			throw new Error(`No side chat provider for ${sessionResource.toString()}`);
		}
		await provider.askInSideChat(sessionResource, query, selection);
	}

	observeSideChatOrigin(sessionResource: URI): IObservable<IChatSideChatOrigin | undefined> {
		let origin = this._sideChatOrigins.get(sessionResource);
		if (!origin) {
			origin = derived(this, reader => {
				for (const provider of this._providers.read(reader)) {
					const providerOrigin = provider.observeSideChatOrigin(sessionResource).read(reader);
					if (providerOrigin !== undefined) {
						return providerOrigin;
					}
				}
				return undefined;
			});
			this._sideChatOrigins.set(sessionResource, origin);
		}
		return origin;
	}

	async revealSideChatSource(sessionResource: URI): Promise<void> {
		for (const provider of this._providers.get()) {
			if (provider.observeSideChatOrigin(sessionResource).get() !== undefined) {
				await provider.revealSideChatSource(sessionResource);
				return;
			}
		}
	}

	private _findProvider(sessionResource: URI): IChatSideChatProvider | undefined {
		for (const provider of this._providers.get()) {
			if (provider.canAskInSideChat(sessionResource)) {
				return provider;
			}
		}
		return undefined;
	}
}
