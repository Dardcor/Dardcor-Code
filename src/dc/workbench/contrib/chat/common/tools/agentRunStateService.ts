/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Memento } from '../../../../common/memento.js';

export const CHAT_AGENT_RUN_STATE_VERSION = 5 as const;

export interface IChatAgentVerificationEvidence {
	readonly message: string;
	readonly workspaceRevision: number;
}

export type ChatAgentRunStatus = 'planning' | 'working' | 'verifying' | 'completed' | 'paused' | 'blocked' | 'cancelled';

export interface IChatAgentRunState {
	readonly version: typeof CHAT_AGENT_RUN_STATE_VERSION;
	readonly status: ChatAgentRunStatus;
	readonly updatedAt: number;
	readonly turn: number;
	readonly stalledTurns: number;
	readonly verificationEvidence: readonly IChatAgentVerificationEvidence[];
	readonly workspaceRevision: number;
	readonly verificationFailures: readonly string[];
	readonly verificationPending: readonly string[];
	readonly browserActions: number;
	readonly lastError?: string;
	readonly taskPrompt?: string;
	readonly nextStep?: string;
}

export const IChatAgentRunStateService = createDecorator<IChatAgentRunStateService>('chatAgentRunStateService');

export interface IChatAgentRunStateService {
	readonly _serviceBrand: undefined;
	getState(sessionResource: URI): IChatAgentRunState | undefined;
	setState(sessionResource: URI, state: IChatAgentRunState): void;
	clearState(sessionResource: URI): void;
	migrateState(oldSessionResource: URI, newSessionResource: URI): void;
}

export function createChatAgentRunState(status: ChatAgentRunStatus = 'planning', now = Date.now()): IChatAgentRunState {
	return {
		version: CHAT_AGENT_RUN_STATE_VERSION,
		status,
		updatedAt: now,
		turn: 0,
		stalledTurns: 0,
		verificationEvidence: [],
		workspaceRevision: 0,
		verificationFailures: [],
		verificationPending: [],
		browserActions: 0,
		taskPrompt: undefined,
		nextStep: undefined,
	};
}

export function updateChatAgentRunState(
	state: IChatAgentRunState,
	patch: Partial<Omit<IChatAgentRunState, 'version' | 'updatedAt'>>,
	now = Date.now(),
): IChatAgentRunState {
	return {
		...state,
		...patch,
		version: CHAT_AGENT_RUN_STATE_VERSION,
		updatedAt: now,
		verificationEvidence: (patch.verificationEvidence ?? state.verificationEvidence).map(item => ({ ...item })),
		verificationFailures: [...(patch.verificationFailures ?? state.verificationFailures)],
		verificationPending: [...(patch.verificationPending ?? state.verificationPending)],
	};
}

function isChatAgentRunState(value: unknown): value is IChatAgentRunState {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const state = value as Partial<IChatAgentRunState>;
	return state.version === CHAT_AGENT_RUN_STATE_VERSION
		&& typeof state.status === 'string'
		&& ['planning', 'working', 'verifying', 'completed', 'paused', 'blocked', 'cancelled'].includes(state.status)
		&& typeof state.updatedAt === 'number'
		&& typeof state.turn === 'number'
		&& typeof state.stalledTurns === 'number'
		&& Array.isArray(state.verificationEvidence)
		&& state.verificationEvidence.every(item => !!item && typeof item.message === 'string' && typeof item.workspaceRevision === 'number')
		&& typeof state.workspaceRevision === 'number'
		&& Array.isArray(state.verificationFailures)
		&& state.verificationFailures.every(item => typeof item === 'string')
		&& Array.isArray(state.verificationPending)
		&& state.verificationPending.every(item => typeof item === 'string')
		&& typeof state.browserActions === 'number'
		&& (state.taskPrompt === undefined || typeof state.taskPrompt === 'string')
		&& (state.nextStep === undefined || typeof state.nextStep === 'string');
}

export function migrateChatAgentRunState(value: unknown): IChatAgentRunState | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const legacy = value as {
		version?: number;
		status?: unknown;
		updatedAt?: unknown;
		turn?: unknown;
		stalledTurns?: unknown;
		verificationEvidence?: unknown;
		workspaceRevision?: unknown;
		verificationFailures?: unknown;
		verificationPending?: unknown;
		browserActions?: unknown;
		lastError?: unknown;
		taskPrompt?: unknown;
		nextStep?: unknown;
	};
	if ((legacy.version !== 1 && legacy.version !== 2 && legacy.version !== 3 && legacy.version !== 4)
		|| typeof legacy.status !== 'string'
		|| !['planning', 'working', 'verifying', 'completed', 'paused', 'blocked', 'cancelled'].includes(legacy.status)
		|| typeof legacy.updatedAt !== 'number'
		|| typeof legacy.turn !== 'number'
		|| typeof legacy.stalledTurns !== 'number'
		|| !Array.isArray(legacy.verificationEvidence)
		|| typeof legacy.browserActions !== 'number') {
		return undefined;
	}
	return {
		version: CHAT_AGENT_RUN_STATE_VERSION,
		status: legacy.status as ChatAgentRunStatus,
		updatedAt: legacy.updatedAt as number,
		turn: legacy.turn as number,
		stalledTurns: legacy.stalledTurns as number,
		verificationEvidence: (legacy.verificationEvidence as unknown[])
			.map((item): IChatAgentVerificationEvidence | undefined => {
				if (typeof item === 'string') {
					return { message: item, workspaceRevision: -1 };
				}
				if (item && typeof item === 'object' && typeof (item as IChatAgentVerificationEvidence).message === 'string') {
					return { message: (item as IChatAgentVerificationEvidence).message, workspaceRevision: -1 };
				}
				return undefined;
			})
			.filter((item): item is IChatAgentVerificationEvidence => !!item),
		workspaceRevision: 0,
		verificationFailures: Array.isArray(legacy.verificationFailures) ? legacy.verificationFailures.filter((item): item is string => typeof item === 'string') : [],
		verificationPending: Array.isArray(legacy.verificationPending) ? legacy.verificationPending.filter((item): item is string => typeof item === 'string') : [],
		browserActions: legacy.browserActions as number,
		lastError: typeof legacy.lastError === 'string' ? legacy.lastError : undefined,
		taskPrompt: typeof legacy.taskPrompt === 'string' ? legacy.taskPrompt : undefined,
		nextStep: typeof legacy.nextStep === 'string' ? legacy.nextStep : undefined,
	};
}

export class ChatAgentRunStateService extends Disposable implements IChatAgentRunStateService {
	declare readonly _serviceBrand: undefined;

	private readonly _memento: Memento<Record<string, unknown>>;

	constructor(@IStorageService storageService: IStorageService) {
		super();
		this._memento = new Memento('dardcor-chat-agent-run-state-v1', storageService);
	}

	getState(sessionResource: URI): IChatAgentRunState | undefined {
		const stored = this._memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE)[this._key(sessionResource)];
		const current = isChatAgentRunState(stored) ? stored : migrateChatAgentRunState(stored);
		return current ? {
			...current,
			verificationEvidence: current.verificationEvidence.map(item => ({ ...item })),
			verificationFailures: [...current.verificationFailures],
			verificationPending: [...current.verificationPending],
		} : undefined;
	}

	setState(sessionResource: URI, state: IChatAgentRunState): void {
		if (!isChatAgentRunState(state)) {
			throw new Error('Invalid Dardcor chat agent run state');
		}
		const storage = this._memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage[this._key(sessionResource)] = {
			...state,
			verificationEvidence: state.verificationEvidence.map(item => ({ ...item })),
			verificationFailures: [...state.verificationFailures],
			verificationPending: [...state.verificationPending],
		};
		this._memento.saveMemento();
	}

	clearState(sessionResource: URI): void {
		const storage = this._memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		delete storage[this._key(sessionResource)];
		this._memento.saveMemento();
	}

	migrateState(oldSessionResource: URI, newSessionResource: URI): void {
		const state = this.getState(oldSessionResource);
		if (!state) {
			return;
		}
		const storage = this._memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage[this._key(newSessionResource)] = state;
		delete storage[this._key(oldSessionResource)];
		this._memento.saveMemento();
	}

	private _key(sessionResource: URI): string {
		const pathParts = sessionResource.path.split('/');
		if (sessionResource.scheme === Schemas.vscodeLocalChatSession && sessionResource.authority && pathParts.length === 2) {
			return new TextDecoder().decode(decodeBase64(pathParts[1]).buffer);
		}
		return sessionResource.toString();
	}
}
