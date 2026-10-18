/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum VoiceCloseCode {
	Unauthenticated = 4001,
	Forbidden = 4003,
	SessionReplaced = 4008,
	ServerBusy = 4029,
	InternalError = 4500,
	AuthUnavailable = 4503,
}

export type VoiceCloseKind = 'fatal' | 'expected' | 'transient';

export type VoiceCloseAction = 'signIn' | 'openSettings';

export interface IVoiceCloseCodeInfo {
	readonly kind: VoiceCloseKind;
	readonly action?: VoiceCloseAction;
}

const INFO = new Map<number, IVoiceCloseCodeInfo>([
	[VoiceCloseCode.Unauthenticated, { kind: 'fatal', action: 'signIn' }],
	[VoiceCloseCode.Forbidden, { kind: 'fatal' }],
	[VoiceCloseCode.SessionReplaced, { kind: 'expected' }],
	[VoiceCloseCode.ServerBusy, { kind: 'transient' }],
	[VoiceCloseCode.InternalError, { kind: 'transient' }],
	[VoiceCloseCode.AuthUnavailable, { kind: 'transient' }],

	[1000, { kind: 'expected' }],
	[1001, { kind: 'expected' }],
	[1011, { kind: 'transient' }],
	[1013, { kind: 'transient' }],
]);

export function voiceCloseCodeInfo(code: number): IVoiceCloseCodeInfo | undefined {
	return INFO.get(code);
}

export function isTerminalCloseCode(code: number): boolean {
	const info = INFO.get(code);
	return info !== undefined && info.kind !== 'transient';
}
