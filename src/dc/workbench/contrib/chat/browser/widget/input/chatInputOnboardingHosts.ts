/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { IVoiceModeOnboardingService } from '../../../../agentsVoice/browser/voiceModeOnboarding.js';
import { IDictationOnboardingService } from '../../speechToText/dictationOnboarding.js';
import { ChatInputNoticeHost, ChatInputNoticeLane } from './chatInputNoticeHost.js';

export function registerChatInputOnboardingHosts(
	host: ChatInputNoticeHost,
	containers: { readonly voice: HTMLElement; readonly dictation: HTMLElement },
	focusRoot: HTMLElement,
	focusInput: () => void,
	voiceModeOnboardingService: IVoiceModeOnboardingService,
	dictationOnboardingService: IDictationOnboardingService,
): IDisposable {
	const claimNotice = (options: Parameters<ChatInputNoticeHost['occupy']>[1]) => host.occupy(ChatInputNoticeLane.Onboarding, options);

	const store = new DisposableStore();
	store.add(voiceModeOnboardingService.registerHost({
		container: containers.voice,
		focusRoot,
		focus: focusInput,
		claimNotice,
	}));
	store.add(dictationOnboardingService.registerHost({
		container: containers.dictation,
		focusRoot,
		focus: focusInput,
		claimNotice,
	}));
	return store;
}
