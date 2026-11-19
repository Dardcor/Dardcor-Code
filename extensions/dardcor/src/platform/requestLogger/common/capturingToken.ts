/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class CapturingToken {
	constructor(
		public readonly label: string,
		public readonly icon: string | undefined,
		public readonly subAgentInvocationId?: string,
		public readonly subAgentName?: string,
		public readonly chatSessionId?: string,
		public readonly parentChatSessionId?: string,
		public readonly debugLogLabel?: string,
	) { }
}
