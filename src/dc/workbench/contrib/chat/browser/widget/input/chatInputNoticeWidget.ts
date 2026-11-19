/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, isAncestorOfActiveElement, setVisibility } from '../../../../../../base/browser/dom.js';
import { ActionBar } from '../../../../../../base/browser/ui/actionbar/actionbar.js';
import { alert, status } from '../../../../../../base/browser/ui/aria/aria.js';
import { StandardKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { Action } from '../../../../../../base/common/actions.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { KeyCode } from '../../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { IChatInputNoticeFocusTarget } from './chatInputNoticeHost.js';
import { getCompactCodicon } from '../../chatIcons.js';
import './media/chatInputNotice.css';

export const enum ChatInputNoticeVariant {
	Onboarding = 'onboarding',
	Tip = 'tip',
	Notification = 'notification',
}

export interface IChatInputNoticeWidgetOptions {
	readonly container?: HTMLElement;
	readonly variant: ChatInputNoticeVariant;
	readonly className?: string;
	readonly ariaLabel?: string;
	readonly ariaDescription?: string;
	readonly ariaRoleDescription?: string;
	readonly onEscape?: () => void;
}

export interface IChatInputNoticeActionOptions {
	readonly className?: string;
	readonly ariaLabel: string;
	readonly icon: ThemeIcon;
	readonly onActivate: () => void;
	readonly parent?: HTMLElement;
	readonly store?: DisposableStore;
}

export type IChatInputNoticeDismissOptions = Omit<IChatInputNoticeActionOptions, 'ariaLabel' | 'icon'> & {
	readonly ariaLabel?: string;
};

export class ChatInputNoticeWidget extends Disposable implements IChatInputNoticeFocusTarget {

	readonly domNode: HTMLElement;

	private readonly _variant: ChatInputNoticeVariant;
	private readonly _ariaRoleDescription: string | undefined;
	private _ariaLabel: string | undefined;
	private _visible = true;

	constructor(options: IChatInputNoticeWidgetOptions) {
		super();

		this._variant = options.variant;
		this._ariaRoleDescription = options.ariaRoleDescription;

		this.domNode = $('div');
		this.domNode.classList.add('chat-input-notice', `chat-input-notice-${options.variant}`);
		if (options.className) {
			this.domNode.classList.add(options.className);
		}
		if (options.ariaDescription) {
			this.domNode.setAttribute('aria-description', options.ariaDescription);
		}
		this.setAriaLabel(options.ariaLabel);

		options.container?.appendChild(this.domNode);
		this._register(toDisposable(() => this.domNode.remove()));

		const onEscape = options.onEscape;
		if (onEscape) {
			this._register(addDisposableListener(this.domNode, EventType.KEY_DOWN, event => {
				const keyboardEvent = new StandardKeyboardEvent(event);
				if (keyboardEvent.equals(KeyCode.Escape)) {
					keyboardEvent.preventDefault();
					keyboardEvent.stopPropagation();
					onEscape();
				}
			}));
		}
	}

	setAriaLabel(ariaLabel: string | undefined): void {
		this._ariaLabel = ariaLabel;
		this._applyRegionAttributes();
	}

	private _applyRegionAttributes(): void {
		if (this._visible) {
			this.domNode.setAttribute('role', 'region');
			this.domNode.tabIndex = 0;
			if (this._ariaRoleDescription) {
				this.domNode.setAttribute('aria-roledescription', this._ariaRoleDescription);
			}
			if (this._ariaLabel) {
				this.domNode.setAttribute('aria-label', this._ariaLabel);
			} else {
				this.domNode.removeAttribute('aria-label');
			}
		} else {
			this.domNode.removeAttribute('role');
			this.domNode.removeAttribute('tabindex');
			this.domNode.removeAttribute('aria-roledescription');
			this.domNode.removeAttribute('aria-label');
		}
	}

	announce(): void {
		if (!this._ariaLabel) {
			return;
		}

		const message = localize('chatInputNotice.focusHint', "{0}. Use Shift+Tab to reach the notice.", this._ariaLabel);
		if (this._variant === ChatInputNoticeVariant.Tip) {
			status(message);
		} else {
			alert(message);
		}
	}

	hasFocus(): boolean {
		return isAncestorOfActiveElement(this.domNode);
	}

	focus(): void {
		this.domNode.focus();
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}

		this._visible = visible;
		setVisibility(visible, this.domNode);
		this._applyRegionAttributes();
	}

	addAction(options: IChatInputNoticeActionOptions): HTMLElement {
		const register = <T extends IDisposable>(disposable: T): T => options.store ? options.store.add(disposable) : this._register(disposable);

		const container = $('div');
		container.classList.add('chat-input-notice-action');
		(options.parent ?? this.domNode).appendChild(container);
		register(toDisposable(() => container.remove()));

		const cssClass = [ThemeIcon.asClassName(getCompactCodicon(options.icon)), options.className].filter(Boolean).join(' ');
		const actionBar = register(new ActionBar(container));
		actionBar.push(register(new Action('chatInputNotice.action', options.ariaLabel, cssClass, true, async () => options.onActivate())), { icon: true, label: false });

		return container;
	}

	addDismissAction(options: IChatInputNoticeDismissOptions): HTMLElement {
		return this.addAction({
			...options,
			ariaLabel: options.ariaLabel ?? localize('chatInputNotice.dismiss', "Dismiss"),
			icon: Codicon.closeCompact,
			className: [options.className, 'chat-input-notice-dismiss'].filter(Boolean).join(' '),
		});
	}
}
