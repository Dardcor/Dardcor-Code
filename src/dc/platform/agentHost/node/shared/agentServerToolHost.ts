/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentServerToolDefinition, IAgentServerToolHost } from '../../common/agentServerTools.js';
import { DardcorAgentToolRuntime } from '../../common/agentToolRuntime.js';
import { ActionType } from '../../common/state/protocol/common/actions.js';
import { parseRequiredSessionUriFromChatUri, type StringOrMarkdown, type ToolDefinition, type URI } from '../../common/state/sessionState.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import type { AgentHostStateManager } from '../agentHostStateManager.js';

export const IAgentHostServerToolService = createDecorator<IAgentHostServerToolService>('agentHostServerToolService');

export interface IAgentHostServerToolService extends IAgentServerToolHost {
	readonly _serviceBrand: undefined;
}

export interface IServerToolDisplayResult {
	readonly text?: string;
	readonly success: boolean;
}

export interface IServerToolDisplay {
	readonly displayName?: string;
	readonly invocationMessage?: StringOrMarkdown;
	readonly pastTenseMessage?: StringOrMarkdown;
	readonly confirmationTitle?: string;
	readonly confirmationMessage?: StringOrMarkdown;
	readonly hideConfirmationInput?: boolean;
}

export interface IServerToolExecutionContext {
	readonly sessionUri: URI;
	readonly chatUri: URI;
	readonly turnId?: string;
}

export interface IServerToolGroup {
	readonly definitions: readonly IAgentServerToolDefinition[];
	readonly legacyToolNames?: ReadonlyMap<string, string>;
	readonly materializeDefinitions?: boolean;
	isEnabled(toolName: string): boolean;
	isEnabledForSession(toolName: string, sessionUri: URI): boolean;
	canRequireConfirmation?(toolName: string): boolean;
	requiresConfirmation?(stateManager: AgentHostStateManager, context: IServerToolExecutionContext, toolName: string): boolean;
	execute(stateManager: AgentHostStateManager, context: IServerToolExecutionContext, toolName: string, rawArgs: unknown): string | Promise<string>;

	getDisplay?(toolName: string, args: unknown, result?: IServerToolDisplayResult): IServerToolDisplay | undefined;
}

export class AgentServerToolHost implements IAgentHostServerToolService {

	declare readonly _serviceBrand: undefined;

	private readonly _toolRuntime = new DardcorAgentToolRuntime();
	private _toolCallSequence = 0;
	private readonly _groupByToolName = new Map<string, IServerToolGroup>();
	private readonly _currentToolNames = new Map<string, string>();

	constructor(
		private readonly _stateManager: AgentHostStateManager,
		private readonly _groups: readonly IServerToolGroup[],
	) {
		for (const group of this._groups) {
			for (const def of group.definitions) {
				if (this._groupByToolName.has(def.name)) {
					throw new Error(`Duplicate server tool registered: ${def.name}`);
				}
				this._groupByToolName.set(def.name, group);
			}
		}
		for (const group of this._groups) {
			for (const [legacyName, currentName] of group.legacyToolNames ?? []) {
				if (this._groupByToolName.has(legacyName)) {
					continue;
				}
				this._groupByToolName.set(legacyName, group);
				this._currentToolNames.set(legacyName, currentName);
			}
		}
		for (const group of this._groups) {
			for (const definition of group.definitions) {
				const name = definition.name;
				const aliases = [...(group.legacyToolNames ?? [])]
					.filter(([legacyName, currentName]) => currentName === name && this._currentToolNames.get(legacyName) === name)
					.map(([legacyName]) => legacyName);
				this._toolRuntime.register({
					name,
					aliases,
					inputSchema: definition.inputSchema ?? { type: 'object' },
					source: 'agent-host',
					risk: definition.annotations?.readOnlyHint === true ? 'read' : 'unknown',
					driver: `agentServerToolGroup:${name}`,
				}, async (args, request) => {
					const chatUri = request.context as URI;
					return group.execute(this._stateManager, this._executionContext(chatUri), name, args);
				});
			}
		}
	}

	private _currentToolName(toolName: string): string {
		return this._currentToolNames.get(toolName) ?? toolName;
	}

	get definitions(): readonly IAgentServerToolDefinition[] {
		return this._groups.flatMap(group => group.definitions.filter(definition => group.isEnabled(definition.name)));
	}

	getDefinitionsForSession(sessionUri: URI): readonly IAgentServerToolDefinition[] {
		const materializedDefinitions = this._stateManager.getSessionState(sessionUri)?.serverTools;
		const isEphemeral = this._stateManager.isEphemeralSession(sessionUri);
		return this._groups.flatMap(group => {
			if (materializedDefinitions && group.materializeDefinitions) {
				const currentByName = new Map(group.definitions.map(definition => [definition.name, definition]));
				return materializedDefinitions
					.filter(definition => this._groupByToolName.get(definition.name) === group)
					.filter(definition => !currentByName.has(definition.name) || group.isEnabledForSession(definition.name, sessionUri))
					.map(definition => currentByName.get(definition.name) ?? definition);
			}
			const definitions = group.definitions.filter(definition => group.isEnabled(definition.name) && group.isEnabledForSession(definition.name, sessionUri));
			return isEphemeral ? definitions.filter(definition => definition.enabledForEphemeralSessions) : definitions;
		});
	}

	get toolNames(): readonly string[] {
		return [
			...this.definitions.map(definition => definition.name),
			...this._groups.flatMap(group => [...(group.legacyToolNames ?? [])]
				.filter(([, currentName]) => group.isEnabled(currentName))
				.map(([legacyName]) => legacyName)),
		];
	}

	advertise(sessionUri: URI): void {
		if (!this._stateManager.getSessionState(sessionUri)) {
			return;
		}
		this._stateManager.dispatchServerAction(sessionUri, {
			type: ActionType.SessionServerToolsChanged,
			tools: this._toProtocolDefinitions(this.getDefinitionsForSession(sessionUri)),
		});
	}

	canRequireConfirmation(toolName: string): boolean {
		const group = this._groupByToolName.get(toolName);
		const name = this._currentToolName(toolName);
		return group?.isEnabled(name) === true && (group.canRequireConfirmation?.(name) ?? false);
	}

	requiresConfirmation(chatUri: URI, toolName: string): boolean {
		const group = this._groupByToolName.get(toolName);
		const name = this._currentToolName(toolName);
		if (group && !this._isEnabledForSession(group, chatUri, name, toolName)) {
			return false;
		}
		return group?.requiresConfirmation?.(this._stateManager, this._executionContext(chatUri), name)
			?? group?.canRequireConfirmation?.(name)
			?? false;
	}

	async executeTool(chatUri: URI, toolName: string, rawArgs: unknown): Promise<string> {
		const group = this._groupByToolName.get(toolName);
		if (!group) {
			throw new Error(`Unknown server tool: ${toolName}`);
		}
		const name = this._currentToolName(toolName);
		if (!this._isEnabledForSession(group, chatUri, name, toolName)) {
			throw new Error(`Server tool "${toolName}" is disabled.`);
		}
		const result = await this._toolRuntime.execute({
			version: 1,
			callId: `agent-host-${++this._toolCallSequence}`,
			toolName,
			arguments: rawArgs,
			context: chatUri,
		});
		if (result.status === 'rejected' || result.status === 'failed') {
			throw new Error(result.output);
		}
		return result.output;
	}

	private _executionContext(chatUri: URI): IServerToolExecutionContext {
		return {
			sessionUri: parseRequiredSessionUriFromChatUri(chatUri),
			chatUri,
			turnId: this._stateManager.getActiveTurnId(chatUri),
		};
	}

	private _toProtocolDefinitions(definitions: readonly IAgentServerToolDefinition[]): ToolDefinition[] {
		return definitions.map(({ enabledForEphemeralSessions: _enabledForEphemeralSessions, ...definition }) => definition);
	}

	private _isEnabledForSession(group: IServerToolGroup, chatUri: URI, toolName: string, requestedToolName = toolName): boolean {
		const sessionUri = parseRequiredSessionUriFromChatUri(chatUri);
		if (!group.isEnabledForSession(toolName, sessionUri)) {
			return false;
		}
		const advertisedTools = this._stateManager.getSessionState(chatUri)?.serverTools;
		return advertisedTools
			? advertisedTools.some(tool => tool.name === toolName) || group.legacyToolNames?.has(requestedToolName) === true
			: group.isEnabled(toolName);
	}
}
