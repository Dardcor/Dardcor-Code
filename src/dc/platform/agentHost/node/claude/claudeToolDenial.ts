/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const CLAUDE_USER_DECLINED_MESSAGE = 'User declined';
export const CLAUDE_PLAN_DECLINED_MESSAGE = 'The user declined the plan, maybe ask why?';
export const CLAUDE_QUESTION_CANCELLED_MESSAGE = 'The user cancelled the question';

export function claudeToolDenialCode(message: string): 'denied' | 'cancelled' | undefined {
	switch (message) {
		case CLAUDE_USER_DECLINED_MESSAGE:
		case CLAUDE_PLAN_DECLINED_MESSAGE:
			return 'denied';
		case CLAUDE_QUESTION_CANCELLED_MESSAGE:
			return 'cancelled';
		default:
			return undefined;
	}
}
