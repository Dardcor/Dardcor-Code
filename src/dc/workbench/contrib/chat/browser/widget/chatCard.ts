/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, IButtonStyles } from '../../../../../base/browser/ui/button/button.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import './media/chatCard.css';

export const CHAT_CARD_LARGE_CLASS = 'chat-card-large';

export const CHAT_CARD_HEADER_CLASS = 'chat-card-header';

export const CHAT_CARD_TITLE_CLASS = 'chat-card-title';

export const CHAT_CARD_HEADER_ACTIONS_CLASS = 'chat-card-header-actions';

export const chatCardButtonStyles: IButtonStyles = {
	buttonBackground: undefined,
	buttonHoverBackground: undefined,
	buttonForeground: undefined,
	buttonSeparator: undefined,
	buttonSecondaryBackground: undefined,
	buttonSecondaryHoverBackground: undefined,
	buttonSecondaryForeground: undefined,
	buttonSecondaryBorder: undefined,
	buttonBorder: undefined,
};

export interface IChatCardIconButtonOptions {
	readonly icon?: ThemeIcon;
	readonly ariaLabel: string;
	readonly hoverContent?: string;
	readonly variant?: 'strong' | 'padded';
}

export function createChatCardIconButton(store: DisposableStore, container: HTMLElement, hoverService: IHoverService, options: IChatCardIconButtonOptions): Button {
	const button = store.add(new Button(container, { ...chatCardButtonStyles, secondary: true, supportIcons: true }));
	button.element.classList.add('chat-card-icon-button');
	if (options.variant) {
		button.element.classList.add(`chat-card-icon-button-${options.variant}`);
	}

	if (options.icon) {
		button.label = `$(${options.icon.id})`;
	}

	button.element.setAttribute('aria-label', options.ariaLabel);
	if (options.hoverContent !== undefined) {
		store.add(hoverService.setupDelayedHover(button.element, { content: options.hoverContent }));
	}

	return button;
}
