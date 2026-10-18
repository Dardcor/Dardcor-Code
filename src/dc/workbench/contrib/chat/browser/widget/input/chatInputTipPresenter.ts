/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IChatTipService } from '../../chatTipService.js';
import { ChatContentMarkdownRenderer } from '../chatContentMarkdownRenderer.js';
import { ChatTipContentPart } from '../chatContentParts/chatTipContentPart.js';
import { ChatInputNoticeHost, ChatInputNoticeLane } from './chatInputNoticeHost.js';
import { ChatInputStackSlot, setChatInputStackSlot } from './chatInputStack.js';

export interface IChatInputTipPresenterOptions {
	readonly container: HTMLElement;
	readonly isEligible: () => boolean;
	readonly focusInput: () => void;
	readonly onBeforeUpdate?: () => void;
}

export class ChatInputTipPresenter extends Disposable {

	private readonly _part = this._register(new MutableDisposable<DisposableStore>());
	private readonly _lease = this._register(new MutableDisposable<IDisposable>());
	private _partRef: ChatTipContentPart | undefined;
	private _leading = false;
	get current(): ChatTipContentPart | undefined {
		return this._partRef;
	}

	constructor(
		private readonly _options: IChatInputTipPresenterOptions,
		private readonly _noticeHost: ChatInputNoticeHost,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IChatTipService private readonly _chatTipService: IChatTipService,
	) {
		super();

		this._register(toDisposable(() => this._clearContent()));

		this.update();
	}

	update(): void {
		this._options.onBeforeUpdate?.();

		if (!this._options.isEligible()) {
			this.clear();
			return;
		}

		if (!this._lease.value) {
			this._lease.value = this._noticeHost.occupy(ChatInputNoticeLane.Tip, {
				focusTarget: {
					hasFocus: () => this._partRef?.hasFocus() ?? false,
					focus: () => this._partRef?.focus(),
					canFocus: () => !!this._partRef,
				},
				onDidChangeLeading: leading => this._setLeading(leading),
			});
		} else if (this._leading) {
			this._render();
		}
	}

	private _setLeading(leading: boolean): void {
		this._leading = leading;
		if (leading) {
			this._render();
		} else {
			this._clearContent();
		}
	}

	private _render(): void {
		const tip = this._chatTipService.getWelcomeTip(this._contextKeyService);
		if (!tip) {
			this._clearContent();
			return;
		}

		if (this._part.value) {
			setChatInputStackSlot(this._options.container, ChatInputStackSlot.Docked);
			return;
		}

		const store = new DisposableStore();
		const renderer = this._instantiationService.createInstance(ChatContentMarkdownRenderer);
		const tipPart = store.add(this._instantiationService.createInstance(ChatTipContentPart, tip, renderer));

		store.add(tipPart.onDidHide(() => {
			this.clear();
			this._options.focusInput();
		}));

		this._part.value = store;
		this._partRef = tipPart;
		dom.clearNode(this._options.container);
		this._options.container.appendChild(tipPart.domNode);
		setChatInputStackSlot(this._options.container, ChatInputStackSlot.Docked);
	}

	clear(): void {
		this._leading = false;
		this._lease.clear();
		this._clearContent();
	}

	private _clearContent(): void {
		this._partRef = undefined;
		this._part.clear();
		dom.clearNode(this._options.container);
		setChatInputStackSlot(this._options.container, ChatInputStackSlot.Empty);
	}
}
