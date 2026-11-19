/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { IAgentHostChatContributions } from '../../common/agentHostChatContributionsService.js';
import { ISessionDataService } from '../../common/sessionDataService.js';
import { ActionType, StateAction } from '../../common/state/sessionActions.js';
import { isAhpChatChannel, parseRequiredSessionUriFromChatUri, ResponsePartKind, ToolCallStatus, ToolResultContentType, type ISessionWithDefaultChat, type Turn, type URI as ProtocolURI } from '../../common/state/sessionState.js';
import { IAgentHostLocalTurns } from '../agentHostLocalTurns.js';
import { IAgentHostSessionTitleController } from '../agentHostSessionTitleController.js';
import { IAgentHostTerminalManager } from '../agentHostTerminalManager.js';
import { AgentHostStateManager, IAgentHostStateManager } from '../agentHostStateManager.js';
import { persistSessionMetadata } from '../shared/persistSessionMetadata.js';

export interface ILocalChatCommandRequest {
	readonly turnChannel: ProtocolURI;
	readonly turnId: string;
	readonly text: string;
}

export interface ILocalChatCommandContext {
	readonly logService: ILogService;
	readonly terminalManager: IAgentHostTerminalManager;
	dispatch(channel: ProtocolURI, action: StateAction): void;
	getState(channel: ProtocolURI): ISessionWithDefaultChat | undefined;
	updateChatTitle(session: ProtocolURI, chat: ProtocolURI, title: string): void;
	persistSessionFlag(session: ProtocolURI, key: string, value: string): void;
	markTitleRenamed(session: ProtocolURI, chat?: ProtocolURI): void;
}

export interface ILocalChatCommandHandling {
	run(): Promise<void>;
	readonly suggestedTitle?: string;
}

export interface ILocalChatCommand extends IDisposable {
	readonly name: string;
	readonly recordsLocalTurn: boolean;
	tryHandle(request: ILocalChatCommandRequest): ILocalChatCommandHandling | undefined;
}

export interface ILocalChatCommandCtor {
	new(context: ILocalChatCommandContext): ILocalChatCommand;
}

class LocalChatCommandRegistryImpl {
	private readonly _ctors: ILocalChatCommandCtor[] = [];

	register(ctor: ILocalChatCommandCtor): void {
		this._ctors.push(ctor);
	}

	createAll(context: ILocalChatCommandContext): ILocalChatCommand[] {
		return this._ctors.map(ctor => new ctor(context));
	}
}

export const LocalChatCommandRegistry = new LocalChatCommandRegistryImpl();

export const IAgentHostLocalCommands = createDecorator<AgentHostLocalCommands>('agentHostLocalCommands');

export class AgentHostLocalCommands extends Disposable {

	declare readonly _serviceBrand: undefined;

	private readonly _commands: readonly ILocalChatCommand[];

	constructor(
		@IAgentHostLocalTurns private readonly _localTurns: IAgentHostLocalTurns,
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@IAgentHostChatContributions private readonly _chatContributions: IAgentHostChatContributions,
		@IAgentHostSessionTitleController private readonly _titleController: IAgentHostSessionTitleController,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostTerminalManager private readonly _terminalManager: IAgentHostTerminalManager,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
	) {
		super();
		const context: ILocalChatCommandContext = {
			logService: this._logService,
			terminalManager: this._terminalManager,
			dispatch: (channel, action) => this._stateManager.dispatchServerAction(channel, action),
			getState: channel => this._stateManager.getSessionState(channel),
			updateChatTitle: (session, chat, title) => this._stateManager.updateChatTitle(session, chat, title),
			persistSessionFlag: (session, key, value) => persistSessionMetadata(this._sessionDataService, this._logService, session, key, value),
			markTitleRenamed: (session, chat) => this._titleController.markTitleRenamed(session, chat),
		};
		this._commands = LocalChatCommandRegistry.createAll(context).map(command => this._register(command));
	}

	tryHandle(request: ILocalChatCommandRequest): ILocalChatCommandHandling | undefined {
		for (const command of this._commands) {
			const handling = command.tryHandle(request);
			if (handling) {
				void this._run(command, handling, request);
				return handling;
			}
		}
		return undefined;
	}

	private async _run(command: ILocalChatCommand, handling: ILocalChatCommandHandling, request: ILocalChatCommandRequest): Promise<void> {
		const stopWatch = StopWatch.create(false);
		try {
			await handling.run();
		} catch (err) {
			this._logService.error(`[AgentHostLocalCommands] Command '${command.name}' failed: ${err instanceof Error ? err.message : String(err)}`, err);
		} finally {
			this._stateManager.dispatchServerAction(request.turnChannel, { type: ActionType.ChatTurnComplete, turnId: request.turnId, duration: Math.max(0, stopWatch.elapsed()) });
			if (command.recordsLocalTurn) {
				this._recordLocalTurn(request.turnChannel, request.turnId);
			}
			const session = isAhpChatChannel(request.turnChannel) ? parseRequiredSessionUriFromChatUri(request.turnChannel) : request.turnChannel;
			this._chatContributions.turnEnd({ session, channel: request.turnChannel, turnId: request.turnId, reason: { kind: 'localCommand' } });
		}
	}

	private _recordLocalTurn(turnChannel: ProtocolURI, turnId: string): void {
		const chat = turnChannel;
		const session = isAhpChatChannel(turnChannel) ? parseRequiredSessionUriFromChatUri(turnChannel) : turnChannel;
		const turns = this._stateManager.getSessionState(turnChannel)?.turns;
		if (!turns) {
			return;
		}
		const index = turns.findIndex(t => t.id === turnId);
		if (index < 0) {
			return;
		}
		const anchorTurnId = this._localTurns.findAnchorTurnId(chat, turns, turnId);
		this._localTurns.record(session, chat, sanitizeLocalTurnForPersistence(turns[index]), anchorTurnId);
	}
}

function sanitizeLocalTurnForPersistence(turn: Turn): Turn {
	const responseParts = turn.responseParts.map(part => {
		if (part.kind !== ResponsePartKind.ToolCall) {
			return part;
		}
		const tc = part.toolCall;
		if (tc.status !== ToolCallStatus.Running && tc.status !== ToolCallStatus.Completed && tc.status !== ToolCallStatus.PendingResultConfirmation) {
			return part;
		}
		if (!tc.content) {
			return part;
		}
		const content = tc.content.filter(c => c.type !== ToolResultContentType.Terminal);
		if (content.length === tc.content.length) {
			return part;
		}
		return { ...part, toolCall: { ...tc, content } };
	});
	return { ...turn, responseParts };
}
