/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ChunkEnvelope, Reassembler } from './webPubSub/chunking.js';
import { ActionEnvelope, ActionType, StateAction } from './state/protocol/common/actions.js';
import { SessionDefaultChatChangedAction } from './state/protocol/channels-session/actions.js';
import { chatReducer } from './state/protocol/channels-chat/reducer.js';
import { ChatState } from './state/protocol/channels-chat/state.js';
import { sessionReducer } from './state/protocol/channels-session/reducer.js';
import { SessionLifecycle, SessionState, SessionStatus } from './state/protocol/channels-session/state.js';
import { ChatAction, SessionAction } from './state/sessionActions.js';

const MAX_RESTART_EPOCH_INITIAL_SEQUENCE = 1;

export class TaskEventReplayError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TaskEventReplayError';
	}
}

export interface IReplayedSession {
	readonly session: string;
	readonly state: SessionState;
	readonly chats: ReadonlyMap<string, ChatState>;
	readonly defaultChat: string;
	readonly modifiedAt: string;
}

export interface IReplayedTaskHistory {
	readonly sessions: readonly IReplayedSession[];
	readonly truncated: boolean;
}

interface ISessionReplayState {
	readonly envelopes: ActionEnvelope[];
	modifiedAt: string;
	nextSeq: number;
	reassembler: Reassembler;
	abandonedChunkGroup: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string, eventIndex: number): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TaskEventReplayError(`Task AHP event ${eventIndex} has an invalid ${field}.`);
	}
	return value;
}

function requireNonNegativeInteger(value: unknown, field: string, eventIndex: number): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new TaskEventReplayError(`Task AHP event ${eventIndex} has an invalid ${field}.`);
	}
	return value as number;
}

function parseActionEnvelope(value: unknown, eventIndex: number): ActionEnvelope {
	if (!isRecord(value)) {
		throw new TaskEventReplayError(`Task AHP event ${eventIndex} did not contain an ActionEnvelope object.`);
	}
	requireNonEmptyString(value['channel'], 'payload.data.channel', eventIndex);
	requireNonNegativeInteger(value['serverSeq'], 'payload.data.serverSeq', eventIndex);

	const action = value['action'];
	if (!isRecord(action)) {
		throw new TaskEventReplayError(`Task AHP event ${eventIndex} has an invalid payload.data.action.`);
	}
	requireNonEmptyString(action['type'], 'payload.data.action.type', eventIndex);

	const rejectionReason = value['rejectionReason'];
	if (rejectionReason !== undefined && rejectionReason !== null) {
		requireNonEmptyString(rejectionReason, 'payload.data.rejectionReason', eventIndex);
	}

	return value as unknown as ActionEnvelope;
}

function sessionChannelFor(sessionId: string): string {
	return sessionId.startsWith('ahp-session:/') ? sessionId : `ahp-session:/${sessionId}`;
}

function seedSessionState(): SessionState {
	return {
		provider: '',
		title: '',
		status: SessionStatus.Idle,
		lifecycle: SessionLifecycle.Ready,
		activeClients: [],
		chats: [],
	};
}

function seedChatState(chatChannel: string, modifiedAt: string): ChatState {
	return {
		resource: chatChannel,
		title: '',
		status: SessionStatus.Idle,
		modifiedAt,
		turns: [],
	};
}

function decodeEvents(events: readonly unknown[]): Map<string, ISessionReplayState> {
	const sessions = new Map<string, ISessionReplayState>();

	for (const [eventIndex, value] of events.entries()) {
		if (!isRecord(value)) {
			throw new TaskEventReplayError(`Task AHP event ${eventIndex} must be an object.`);
		}
		if (value['ns'] !== 'ahp') {
			throw new TaskEventReplayError(`Task AHP event ${eventIndex} has an invalid ns.`);
		}

		const session = sessionChannelFor(requireNonEmptyString(value['session_id'], 'session_id', eventIndex));
		const seq = requireNonNegativeInteger(value['seq'], 'seq', eventIndex);
		const at = requireNonEmptyString(value['at'], 'at', eventIndex);

		let entry = sessions.get(session);
		if (!entry) {
			entry = { envelopes: [], modifiedAt: at, nextSeq: seq, reassembler: new Reassembler(), abandonedChunkGroup: false };
			sessions.set(session, entry);
		}
		entry.modifiedAt = at;

		const startsRestartEpoch = seq !== entry.nextSeq && seq < entry.nextSeq && seq <= MAX_RESTART_EPOCH_INITIAL_SEQUENCE;
		if (seq !== entry.nextSeq && !startsRestartEpoch) {
			throw new TaskEventReplayError(
				`Task AHP event ${eventIndex} for session '${session}' has sequence ${seq}; expected ${entry.nextSeq}.`);
		}
		if (startsRestartEpoch) {
			entry.abandonedChunkGroup ||= entry.reassembler.inFlightGroupCount > 0;
			entry.nextSeq = seq;
			entry.reassembler = new Reassembler();
		}
		entry.nextSeq += 1;

		let reassembled: unknown;
		try {
			reassembled = entry.reassembler.ingest(value['payload'] as ChunkEnvelope);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown chunking failure';
			throw new TaskEventReplayError(
				`Task AHP event ${eventIndex} for session '${session}' could not be reassembled: ${message}`);
		}

		if (reassembled === null) {
			continue;
		}

		const envelope = parseActionEnvelope(reassembled, eventIndex);
		if (!envelope.rejectionReason) {
			entry.envelopes.push(envelope);
		}
	}

	return sessions;
}

function foldSession(session: string, entry: ISessionReplayState): IReplayedSession {
	let state = seedSessionState();
	const chats = new Map<string, ChatState>();
	let defaultChat = `${session}/chat`;

	for (const envelope of entry.envelopes) {
		const channel = envelope.channel;
		const action: StateAction = envelope.action;

		if (action.type.startsWith('session/') && channel === session) {
			state = sessionReducer(state, action as SessionAction);
			if (action.type === ActionType.SessionDefaultChatChanged) {
				defaultChat = (action as SessionDefaultChatChangedAction).defaultChat || `${session}/chat`;
			}
			continue;
		}
		if (action.type.startsWith('chat/')) {
			const current = chats.get(channel) ?? seedChatState(channel, entry.modifiedAt);
			chats.set(channel, chatReducer(current, action as ChatAction));
		}
	}

	if (!chats.has(defaultChat)) {
		chats.set(defaultChat, seedChatState(defaultChat, entry.modifiedAt));
	}

	return { session, state, chats, defaultChat, modifiedAt: entry.modifiedAt };
}

export function replayTaskAhpEvents(events: readonly unknown[]): IReplayedTaskHistory | undefined {
	const decoded = decodeEvents(events);
	if (decoded.size === 0) {
		return undefined;
	}

	const sessions: IReplayedSession[] = [];
	let truncated = false;
	for (const [session, entry] of decoded) {
		sessions.push(foldSession(session, entry));
		truncated ||= entry.abandonedChunkGroup || entry.reassembler.inFlightGroupCount > 0;
	}
	return { sessions, truncated };
}

export function parseTaskEventsResponse(body: unknown): readonly unknown[] {
	if (!isRecord(body) || !Array.isArray(body['events'])) {
		throw new TaskEventReplayError('Task AHP history response is malformed.');
	}
	const total = body['total'];
	if (!Number.isInteger(total) || (total as number) < 0) {
		throw new TaskEventReplayError('Task AHP history response has an invalid total.');
	}
	if (total !== body['events'].length) {
		throw new TaskEventReplayError('Task AHP history response has an inconsistent total.');
	}
	return body['events'];
}
