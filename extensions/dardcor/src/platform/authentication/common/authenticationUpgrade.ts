/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatContext, ChatRequest, ChatResponseStream } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/dardcor/base/common/event';


export const IAuthenticationChatUpgradeService = createServiceIdentifier<IAuthenticationChatUpgradeService>('IAuthenticationChatUpgradeService');

export interface IAuthenticationChatUpgradeService {
	_serviceBrand: undefined;

	readonly onDidGrantAuthUpgrade: Event<void>;

	shouldRequestPermissiveSessionUpgrade(): Promise<boolean>;

	showPermissiveSessionModal(skipRepeatCheck?: boolean): Promise<boolean>;

	showPermissiveSessionUpgradeInChat(stream: ChatResponseStream, data: ChatRequest, detail?: string, context?: ChatContext): void;

	handleConfirmationRequest(stream: ChatResponseStream, request: ChatRequest, history: ChatContext['history']): Promise<ChatRequest>;
}
