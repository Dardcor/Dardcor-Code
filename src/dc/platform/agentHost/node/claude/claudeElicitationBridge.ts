/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ElicitationRequest, ElicitationResult } from '@anthropic-ai/claude-agent-sdk';
import { ChatInputResponseKind } from '../../common/state/sessionState.js';
import { ClaudeAgentSession } from './claudeAgentSession.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { buildElicitationRequest, cancelledElicitationResult, elicitationResultFromAnswers } from './claudeElicitation.js';

export interface IClaudeElicitationDeps {
	readonly getSession: (sessionId: string) => ClaudeAgentSession | undefined;
}

export async function handleElicitation(
	deps: IClaudeElicitationDeps,
	sessionId: string,
	request: ElicitationRequest,
	options: { readonly signal: AbortSignal; readonly requestId?: string },
): Promise<ElicitationResult> {
	const session = deps.getSession(sessionId);
	if (!session) {
		return cancelledElicitationResult();
	}

	const requestId = options.requestId ?? generateUuid();

	if (options.signal.aborted) {
		return cancelledElicitationResult();
	}

	const chatRequest = buildElicitationRequest(requestId, request);
	if (!chatRequest.url && !chatRequest.questions?.length) {
		return cancelledElicitationResult();
	}

	const abortHandler = () => {
		session.respondToUserInputRequest(requestId, ChatInputResponseKind.Cancel);
	};
	options.signal.addEventListener('abort', abortHandler);
	try {
		const { response, answers } = await session.requestUserInput(chatRequest);
		return elicitationResultFromAnswers(request, response, answers);
	} finally {
		options.signal.removeEventListener('abort', abortHandler);
	}
}
