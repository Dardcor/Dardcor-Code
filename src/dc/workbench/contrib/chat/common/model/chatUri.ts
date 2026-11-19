/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer, decodeBase64 } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localChatSessionType } from '../chatSessionsService.js';

type ChatSessionIdentifier = {
	readonly chatSessionType: string;
	readonly sessionId: string;
};


export namespace LocalChatSessionUri {

	export const scheme = Schemas.vscodeLocalChatSession;

	export function forSession(sessionId: string): URI {
		const encodedId = encodeBase64(VSBuffer.wrap(new TextEncoder().encode(sessionId)), false, true);
		return URI.from({ scheme, authority: localChatSessionType, path: '/' + encodedId });
	}

	export function getNewSessionUri(): URI {
		const handle = Math.floor(Math.random() * 1e9);
		return forSession(`chat-${handle}`);
	}

	export function parseLocalSessionId(resource: URI): string | undefined {
		const parsed = parse(resource);
		return parsed?.chatSessionType === localChatSessionType ? parsed.sessionId : undefined;
	}

	export function isLocalSession(resource: URI): boolean {
		return !!parseLocalSessionId(resource);
	}

	function parse(resource: URI): ChatSessionIdentifier | undefined {
		if (resource.scheme !== scheme) {
			return undefined;
		}

		if (!resource.authority) {
			return undefined;
		}

		const parts = resource.path.split('/');
		if (parts.length !== 2) {
			return undefined;
		}

		const chatSessionType = resource.authority;
		const decodedSessionId = decodeBase64(parts[1]);
		return { chatSessionType, sessionId: new TextDecoder().decode(decodedSessionId.buffer) };
	}
}

export function chatSessionResourceToId(resource: URI): string {
	const localId = LocalChatSessionUri.parseLocalSessionId(resource);
	if (localId) {
		return localId;
	}

	return resource.toString();
}

export function getChatSessionStorageResource(storageRoot: URI, sessionId: string, suffix: string = ''): URI {
	const resource = extUri.joinPath(storageRoot, `${sessionId}${suffix}`);
	if (!extUri.isEqual(extUri.dirname(resource), storageRoot)) {
		throw new Error(`Invalid chat session ID: ${sessionId}`);
	}
	return resource;
}

export function getChatSessionType(resource: URI): string {
	if (resource.scheme === Schemas.vscodeChatEditor) {
		return localChatSessionType;
	}

	if (resource.scheme === LocalChatSessionUri.scheme) {
		return resource.authority || localChatSessionType;
	}

	return resource.scheme;
}

export function isUntitledChatSession(resource: URI): boolean {
	return resource.path.startsWith('/untitled-');
}

export function getNewChatSessionResource(sessionType: string): URI {
	return sessionType === localChatSessionType
		? LocalChatSessionUri.getNewSessionUri()
		: URI.from({ scheme: sessionType, path: `/untitled-${generateUuid()}` });
}
