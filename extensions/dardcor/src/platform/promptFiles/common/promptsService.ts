/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatCustomAgent, ChatHook, ChatInstruction, ChatPlugin, ChatSkill, ChatSlashCommand } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/dardcor/base/common/event';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { URI } from '../../../util/dardcor/base/common/uri';
import { ParsedPromptFile } from '../../../util/dardcor/workbench/contrib/chat/common/promptSyntax/promptFileParser';

export * from '../../../util/dardcor/workbench/contrib/chat/common/promptSyntax/promptFileParser';

export const IPromptsService = createServiceIdentifier<IPromptsService>('IPromptsService');

export namespace PromptFileLangageId {
	export const prompt = 'prompt';
	export const instructions = 'instructions';
	export const agent = 'chatagent';
}

export enum AgentInstructionFileType {
	agentsMd = 'agentsMd',
	claudeMd = 'claudeMd',
	dardcorInstructionsMd = 'dardcorInstructionsMd',
}

export namespace PromptConfig {
	export const USE_AGENT_MD = 'chat.useAgentsMdFile';
	export const USE_NESTED_AGENT_MD = 'chat.useNestedAgentsMdFiles';
	export const USE_CLAUDE_MD = 'chat.useClaudeMdFile';
	export const USE_CUSTOMIZATIONS_IN_PARENT_REPOS = 'chat.useCustomizationsInParentRepositories';
	export const INCLUDE_APPLYING_INSTRUCTIONS = 'chat.includeApplyingInstructions';
	export const INCLUDE_REFERENCED_INSTRUCTIONS = 'chat.includeReferencedInstructions';
	export const USE_SKILL_ADHERENCE_PROMPT = 'chat.experimental.useSkillAdherencePrompt';
	export const COLLECT_INSTRUCTIONS_IN_EXTENSION = 'chat.experimental.collectInstructionsInExtension';
}

export interface IAgentInstructionFile {
	readonly uri: URI;
	readonly realPath?: URI;
	readonly type: AgentInstructionFileType;
}

export interface AgentInstructionsLogger {
	logInfo(message: string): void;
}

export interface IPromptsService {
	readonly _serviceBrand: undefined;
	parseFile(uri: URI, token: CancellationToken): Promise<ParsedPromptFile>;

	readonly onDidChangeCustomAgents: Event<void>;

	getCustomAgents(token: CancellationToken): Promise<readonly ChatCustomAgent[]>;

	getSlashCommands(token: CancellationToken): Promise<readonly ChatSlashCommand[]>;

	readonly onDidChangeInstructions: Event<void>;

	getInstructions(token: CancellationToken): Promise<readonly ChatInstruction[]>;

	readonly onDidChangeSkills: Event<void>;

	getSkills(token: CancellationToken): Promise<readonly ChatSkill[]>;

	readonly onDidChangeHooks: Event<void>;

	getHooks(token: CancellationToken): Promise<readonly ChatHook[]>;

	readonly onDidChangePlugins: Event<void>;

	getPlugins(token: CancellationToken): Promise<readonly ChatPlugin[]>;

	listAgentInstructions(token: CancellationToken, logger?: AgentInstructionsLogger): Promise<IAgentInstructionFile[]>;

	listNestedAgentMDs(token: CancellationToken): Promise<IAgentInstructionFile[]>;


}
