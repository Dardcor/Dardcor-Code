/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../../../../base/browser/dom.js';
import './media/chatInputStack.css';

export const chatInputSurfaceStackClass = 'chat-input-surface-stack';

export const chatInputSurfaceStackSlotClass = 'chat-input-surface-stack-slot';

export const chatInputStackClass = 'chat-input-stack';

export const chatInputStackSlotClass = 'chat-input-stack-slot';

export const enum ChatInputStackSlot {
	Empty,
	Docked,
	Standalone,
}

const dockedClass = 'chat-input-stack-docked';
const standaloneClass = 'chat-input-stack-standalone';
const continuesClass = 'chat-input-stack-continues';
const inputFocusedClass = 'chat-input-stack-input-focused';
const inputWorkingClass = 'chat-input-stack-input-working';

export function setChatInputStackSlot(slot: HTMLElement | null | undefined, state: ChatInputStackSlot): void {
	if (!slot) {
		return;
	}
	slot.classList.toggle(dockedClass, state === ChatInputStackSlot.Docked);
	slot.classList.toggle(standaloneClass, state === ChatInputStackSlot.Standalone);

	refreshChatInputStack(slot.parentElement);
}

export function isChatInputStackSlotShowing(slot: HTMLElement): boolean {
	return slot.classList.contains(dockedClass) || slot.classList.contains(standaloneClass);
}

export function setChatInputStackInputFocused(input: HTMLElement, focused: boolean): void {
	setChatInputStackInputState(input, inputFocusedClass, focused);
}

export function setChatInputStackInputWorking(input: HTMLElement, working: boolean): void {
	setChatInputStackInputState(input, inputWorkingClass, working);
}

export function refreshChatInputStack(stack: HTMLElement | null | undefined): void {
	if (stack?.classList.contains(chatInputStackClass)) {
		updateChatInputStack(stack);
	}
}

function updateChatInputStack(stack: HTMLElement): void {
	let docked = stack.classList.contains(continuesClass);

	for (const slot of stack.children) {
		if (!isHTMLElement(slot)) {
			continue;
		}
		slot.classList.toggle(continuesClass, docked);

		if (slot.classList.contains(dockedClass)) {
			docked = true;
		} else if (slot.classList.contains(standaloneClass)) {
			docked = false;
		}

		if (slot.classList.contains(chatInputStackClass)) {
			updateChatInputStack(slot);
		}
	}
}

function setChatInputStackInputState(input: HTMLElement, stateClass: string, enabled: boolean): void {
	input.closest(`.${chatInputStackClass}`)?.classList.toggle(stateClass, enabled);
}
