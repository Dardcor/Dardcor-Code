/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { IS_CLIENT_DISPATCHABLE, type RootAction, type ClientRootAction, type SessionAction, type ClientSessionAction, type TerminalAction, type ClientTerminalAction, type ChangesetAction, type ClientChangesetAction, type AnnotationsAction, type ClientAnnotationsAction, type AutomationAction, type ClientAutomationAction, type AutomationRunAction, type ClientAutomationRunAction } from '../action-origin.generated.js';

export function softAssertNever(value: never, log?: (msg: string) => void): void {
	const msg = `Unhandled action type: ${JSON.stringify(value)}`;
	(log ?? console.warn)(msg);
}


export function isClientDispatchable(action: RootAction | SessionAction | TerminalAction | ChangesetAction | AnnotationsAction | AutomationAction | AutomationRunAction): action is ClientRootAction | ClientSessionAction | ClientTerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction {
	return IS_CLIENT_DISPATCHABLE[action.type];
}
