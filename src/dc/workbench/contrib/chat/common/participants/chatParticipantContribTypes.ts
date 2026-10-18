/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatModeKind, RawChatParticipantLocation } from '../constants.js';

export interface IRawChatCommandContribution {
	name: string;
	description: string;
	sampleRequest?: string;
	isSticky?: boolean;
	when?: string;
	disambiguation?: { category: string; categoryName?: string ; description: string; examples: string[] }[];
}

export interface IRawChatParticipantContribution {
	id: string;
	name: string;
	fullName: string;
	when?: string;
	description?: string;
	isDefault?: boolean;
	isSticky?: boolean;
	sampleRequest?: string;
	commands?: IRawChatCommandContribution[];
	locations?: RawChatParticipantLocation[];
	modes?: ChatModeKind[];
	disambiguation?: { category: string; categoryName?: string ; description: string; examples: string[] }[];
}

export const CHAT_PROVIDER_ID = 'copilot';
