/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IRemoteAgentHostReconnectPolicy {
	readonly autoRestore: boolean;
	readonly initialDelayMs: number;
	readonly maxDelayMs: number;
	readonly maxAttempts: number;
}

export const DEFAULT_RECONNECT_POLICY: IRemoteAgentHostReconnectPolicy = {
	autoRestore: true,
	initialDelayMs: 1000,
	maxDelayMs: 30_000,
	maxAttempts: 10,
};

export function computeReconnectDelay(policy: IRemoteAgentHostReconnectPolicy, attempt: number): number {
	return Math.min(policy.initialDelayMs * Math.pow(2, attempt - 1), policy.maxDelayMs);
}

export function hasExhaustedReconnectAttempts(policy: IRemoteAgentHostReconnectPolicy, attempt: number): boolean {
	return attempt >= policy.maxAttempts;
}
