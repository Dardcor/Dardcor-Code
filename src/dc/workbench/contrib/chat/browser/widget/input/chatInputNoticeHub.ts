/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ChatInputNoticeHost, IChatInputSurface, pickActiveChatInput, trackChatInputRecency } from './chatInputNoticeHost.js';

export const IChatInputNoticeHubService = createDecorator<IChatInputNoticeHubService>('chatInputNoticeHubService');

export interface IChatInputNoticeHubService {
	readonly _serviceBrand: undefined;

	registerHost(host: ChatInputNoticeHost, focusRoot: HTMLElement): IDisposable;

	toggleNoticeFocus(): boolean;
}

interface ITrackedHost extends IChatInputSurface {
	readonly host: ChatInputNoticeHost;
}

class ChatInputNoticeHubService extends Disposable implements IChatInputNoticeHubService {

	declare readonly _serviceBrand: undefined;

	private readonly _hosts = new Set<ITrackedHost>();

	registerHost(host: ChatInputNoticeHost, focusRoot: HTMLElement): IDisposable {
		const tracked: ITrackedHost = { host, focusRoot, lastFocused: 0 };
		this._hosts.add(tracked);

		const store = new DisposableStore();
		store.add(trackChatInputRecency(tracked));
		store.add(toDisposable(() => this._hosts.delete(tracked)));
		return store;
	}

	toggleNoticeFocus(): boolean {
		const active = pickActiveChatInput(this._hosts, tracked => tracked.host.hasFocusableNotice());
		return active?.host.toggleFocus() ?? false;
	}
}

registerSingleton(IChatInputNoticeHubService, ChatInputNoticeHubService, InstantiationType.Delayed);
