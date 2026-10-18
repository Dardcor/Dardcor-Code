/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface IMonacoPerformanceMarks {
	mark(name: string, markOptions?: { startTime?: number }): void;
	getMarks(): { name: string; startTime: number }[];
	clearMarks(name?: string): void;
}

function _getNativePolyfill(): IMonacoPerformanceMarks {
	return {
		mark: (name, markOptions) => performance.mark(name, markOptions),
		getMarks: () => performance.getEntries().filter(e => e.entryType === 'mark').map(e => ({ name: e.name, startTime: e.startTime })),
		clearMarks: name => {
			performance.clearMarks(name);
		},
	};
}

const perf: IMonacoPerformanceMarks = (globalThis as { MonacoPerformanceMarks?: IMonacoPerformanceMarks }).MonacoPerformanceMarks ?? _getNativePolyfill();

const chatExtPrefix = 'code/chat/ext/';

const chatExtMarksBySession = new Map<string, Set<string>>();































export const ChatExtPerfMark = {
	WillHandleParticipant: 'willHandleParticipant',
	DidHandleParticipant: 'didHandleParticipant',
	WillBuildPrompt: 'willBuildPrompt',
	DidBuildPrompt: 'didBuildPrompt',
	WillFetch: 'willFetch',
	DidFetch: 'didFetch',
} as const;

export type ChatExtPerfMarkName = typeof ChatExtPerfMark[keyof typeof ChatExtPerfMark];

export function markChatExt(sessionId: string | undefined, name: ChatExtPerfMarkName): void {
	if (sessionId) {
		const fullName = `${chatExtPrefix}${sessionId}/${name}`;
		let names = chatExtMarksBySession.get(sessionId);
		if (!names) {
			names = new Set();
			chatExtMarksBySession.set(sessionId, names);
		}
		names.add(fullName);
		perf.mark(fullName);
	}
}

export function clearChatExtMarks(sessionId: string): void {
	const names = chatExtMarksBySession.get(sessionId);
	if (names) {
		for (const name of names) {
			perf.clearMarks(name);
		}
		chatExtMarksBySession.delete(sessionId);
	}
}

export const ChatExtGlobalPerfMark = {
	WillActivate: 'willActivate',
	DidActivate: 'didActivate',
	WillWaitForCopilotToken: 'willWaitForCopilotToken',
	DidWaitForCopilotToken: 'didWaitForCopilotToken',
} as const;

export type ChatExtGlobalPerfMarkName = typeof ChatExtGlobalPerfMark[keyof typeof ChatExtGlobalPerfMark];

export function markChatExtGlobal(name: ChatExtGlobalPerfMarkName): void {
	perf.mark(`${chatExtPrefix}${name}`);
}

export function getChatExtMarks(): { name: string; startTime: number }[] {
	return perf.getMarks();
}
