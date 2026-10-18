/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ChatReferenceTransferData } from '../../../../../platform/dnd/browser/dnd.js';
import { createChatReferenceVariableEntry, IChatRequestChatReferenceVariableEntry } from '../../common/attachments/chatVariableEntries.js';

function tryParseUri(value: string): URI | undefined {
	try {
		return URI.parse(value);
	} catch {
		return undefined;
	}
}

export function isSelfChatReferenceDrop(droppedClientResource: string, ownClientResource: string): boolean {
	const dropped = tryParseUri(droppedClientResource);
	const own = tryParseUri(ownClientResource);
	if (!dropped || !own) {
		return true;
	}
	return isEqual(dropped, own);
}

export function isCrossAgentHostChatReferenceDrop(droppedClientResource: string, ownClientResource: string): boolean {
	const dropped = tryParseUri(droppedClientResource);
	const own = tryParseUri(ownClientResource);
	if (!dropped || !own) {
		return true;
	}
	return dropped.scheme !== own.scheme || dropped.authority !== own.authority;
}

export function resolveChatReferenceDropEntry(data: ChatReferenceTransferData, ownClientResource: string | undefined): IChatRequestChatReferenceVariableEntry | undefined {
	if (ownClientResource === undefined) {
		return undefined;
	}
	if (isSelfChatReferenceDrop(data.clientResource, ownClientResource)
		|| isCrossAgentHostChatReferenceDrop(data.clientResource, ownClientResource)) {
		return undefined;
	}
	const chatResource = tryParseUri(data.chatResource);
	if (!chatResource) {
		return undefined;
	}
	return createChatReferenceVariableEntry(chatResource, undefined, data.title);
}
