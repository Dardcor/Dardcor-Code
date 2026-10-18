/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../util/dardcor/base/common/uri';
import { Schemas } from '../../../util/dardcor/base/common/network';

export namespace SessionType {
	export const Local = 'local';
	export const ClaudeCode = 'claude-code';
	export const Codex = 'openai-codex';
	export const Growth = 'dardcor-growth';
	export const AgentHostCopilot = 'agent-host-dardcor';
}



export function decodeSessionId(sessionResource: URI): string {
	if (sessionResource.scheme === SessionType.ClaudeCode) {
		return sessionResource.path.replace(/^\//, '');
	}
	const pathSegment = sessionResource.path.replace(/^\//, '').split('/').pop() || '';
	if (pathSegment) {
		try {
			return Buffer.from(pathSegment, 'base64').toString('utf-8');
		} catch { }
	}
	return sessionResource.toString();
}

export function getChatSessionType(sessionResource: URI): string {
	if (sessionResource.scheme === Schemas.vscodeChatEditor) {
		return SessionType.Local;
	}

	if (sessionResource.scheme === Schemas.vscodeLocalChatSession) {
		return sessionResource.authority || SessionType.Local;
	}

	return sessionResource.scheme;
}

export function matchesSessionType(sessionTypes: readonly string[] | undefined, currentSessionType: string | undefined): boolean {
	return sessionTypes === undefined || currentSessionType === undefined || sessionTypes.includes(currentSessionType);
}

