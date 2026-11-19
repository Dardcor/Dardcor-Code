/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IRectangle } from '../../../../platform/window/common/window.js';

export const CHAT_INPUT_WINDOW_TOGGLE_COMMAND_ID = 'workbench.action.chat.toggleInputWindow';
export const CHAT_INPUT_WINDOW_ACCEPT_VOICE_COMMAND_ID = '_chat.omni.acceptVoiceInput';
export const CHAT_INPUT_WINDOW_SET_VOICE_TARGET_COMMAND_ID = '_chat.voice.setOmniTarget';

export const CHAT_INPUT_WINDOW_DEFAULT_HEIGHT = 110;

export const enum ChatInputWindowStorageKeys {
	WindowOpen = 'chatInputWindow.windowOpen',
	WindowPosition = 'chatInputWindow.windowPosition',
}

export const IChatInputWindowService = createDecorator<IChatInputWindowService>('chatInputWindowService');

export interface IChatInputWindowService {
	readonly _serviceBrand: undefined;

	readonly isOpen: boolean;
	readonly hasFocus: boolean;

	readonly onDidChangeOpen: Event<boolean>;

	acceptVoiceInput(text: string): Promise<boolean>;

	openWindow(invokingWindowBounds?: IRectangle): Promise<void>;

	closeWindow(): void;

	toggleWindow(invokingWindowBounds?: IRectangle): Promise<void>;
}
