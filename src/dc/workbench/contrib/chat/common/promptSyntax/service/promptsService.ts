/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../base/common/event.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IChatModeInstructions, IVariableReference } from '../../chatModes.js';
import { PromptFileSource, PromptsType, Target } from '../promptTypes.js';
import { IHandOff, ParsedPromptFile } from '../promptFileParser.js';
import { ResourceSet } from '../../../../../../base/common/map.js';
import { IResolvedPromptSourceFolder } from '../config/promptFileLocations.js';
import { ChatRequestHooks } from '../hookSchema.js';
import { isEqual } from '../../../../../../base/common/resources.js';

export interface InstructionsCollectionDebugEntry {
	readonly category: 'applying' | 'skipped' | 'referenced' | 'skill' | 'custom-agent' | 'hook';
	readonly name: string;
	readonly uri?: URI;
	readonly reason?: string;
}

export type InstructionsCollectionEvent = {
	applyingInstructionsCount: number;
	referencedInstructionsCount: number;
	agentInstructionsCount: number;
	listedInstructionsCount: number;
	totalInstructionsCount: number;
	claudeRulesCount: number;
	claudeMdCount: number;
	claudeAgentsCount: number;
};

export type InstructionsCollectionDebugInfo = {
	debugDetails: InstructionsCollectionDebugEntry[];
	durationInMillis: number;
};

export function newInstructionsCollectionEvent(): InstructionsCollectionEvent {
	return { applyingInstructionsCount: 0, referencedInstructionsCount: 0, agentInstructionsCount: 0, listedInstructionsCount: 0, totalInstructionsCount: 0, claudeRulesCount: 0, claudeMdCount: 0, claudeAgentsCount: 0 };
}

export function newInstructionsCollectionDebugInfo(): InstructionsCollectionDebugInfo {
	return { debugDetails: [], durationInMillis: 0 };
}

export const CUSTOM_AGENT_PROVIDER_ACTIVATION_EVENT = 'onCustomAgentProvider';
export const INSTRUCTIONS_PROVIDER_ACTIVATION_EVENT = 'onInstructionsProvider';
export const PROMPT_FILE_PROVIDER_ACTIVATION_EVENT = 'onPromptFileProvider';
export const SKILL_PROVIDER_ACTIVATION_EVENT = 'onSkillProvider';

export interface IPromptFileContext { }

export interface IPromptFileResource {
	readonly uri: URI;
	readonly name?: string;
	readonly description?: string;
	readonly when?: string;
	readonly sessionTypes?: readonly string[];
}

export function matchesSessionType(sessionTypes: readonly string[] | undefined, currentSessionType: string | undefined): boolean {
	return sessionTypes === undefined || currentSessionType === undefined || sessionTypes.includes(currentSessionType);
}

export const IPromptsService = createDecorator<IPromptsService>('IPromptsService');

export enum PromptsStorage {
	local = 'local',
	user = 'user',
	extension = 'extension',
	plugin = 'plugin',
	builtIn = 'builtin',
}

export function isUserToggleableCustomization(type: PromptsType, storage: PromptsStorage): boolean {
	return type === PromptsType.skill && storage === PromptsStorage.builtIn;
}

export type IPromptPath = IExtensionPromptPath | ILocalPromptPath | IUserPromptPath | IPluginPromptPath | IBuiltinPromptPath;


export interface IPromptPathBase {
	readonly uri: URI;

	readonly storage: PromptsStorage;

	readonly type: PromptsType;

	readonly extension?: IExtensionDescription;

	readonly pluginUri?: URI;

	readonly pluginLabel?: string;

	readonly source?: PromptFileSource;

	readonly name?: string;

	readonly description?: string;

	readonly sessionTypes?: readonly string[];
}

export interface IExtensionPromptPath extends IPromptPathBase {
	readonly storage: PromptsStorage.extension;
	readonly extension: IExtensionDescription;
	readonly source: PromptFileSource.ExtensionContribution | PromptFileSource.ExtensionAPI;
	readonly name?: string;
	readonly description?: string;
	readonly when?: string;
}

export function isExtensionPromptPath(obj: IPromptPath): obj is IExtensionPromptPath {
	return obj.storage === PromptsStorage.extension;
}

export interface ILocalPromptPath extends IPromptPathBase {
	readonly storage: PromptsStorage.local;
}
export interface IUserPromptPath extends IPromptPathBase {
	readonly storage: PromptsStorage.user;
}

export interface IPluginPromptPath extends IPromptPathBase {
	readonly storage: PromptsStorage.plugin;
	readonly pluginUri: URI;
	readonly source: PromptFileSource.Plugin;
}

export interface IBuiltinPromptPath extends IPromptPathBase {
	readonly storage: PromptsStorage.builtIn;
}

export function isBuiltinPromptPath(obj: IPromptPath): obj is IBuiltinPromptPath {
	return obj.storage === PromptsStorage.builtIn;
}

export type IAgentSource = {
	readonly storage: PromptsStorage.extension;
	readonly extensionId: ExtensionIdentifier;
} | {
	readonly storage: PromptsStorage.local | PromptsStorage.user | PromptsStorage.builtIn;
} | {
	readonly storage: PromptsStorage.plugin;
	readonly pluginUri: URI;
};

export namespace IAgentSource {
	export function fromPromptPath(promptPath: IPromptPath): IAgentSource {
		if (promptPath.storage === PromptsStorage.extension) {
			return { storage: PromptsStorage.extension, extensionId: promptPath.extension.identifier };
		} else if (promptPath.storage === PromptsStorage.plugin) {
			return { storage: PromptsStorage.plugin, pluginUri: promptPath.pluginUri! };
		} else {
			return { storage: promptPath.storage };
		}
	}

	export function isEquals(a: IAgentSource | undefined, b: IAgentSource | undefined): boolean {
		if (a === b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		if (a.storage !== b.storage) {
			return false;
		}
		if (a.storage === PromptsStorage.extension && b.storage === PromptsStorage.extension) {
			return ExtensionIdentifier.equals(a.extensionId, b.extensionId);
		} else if (a.storage === PromptsStorage.plugin && b.storage === PromptsStorage.plugin) {
			return isEqual(a.pluginUri, b.pluginUri);
		}
		return true;
	}
}

export type ICustomAgentVisibility = {
	readonly userInvocable: boolean;
	readonly agentInvocable: boolean;
};

export function isCustomAgentVisibility(obj: unknown): obj is ICustomAgentVisibility {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const v = obj as { userInvocable?: unknown; agentInvocable?: unknown };
	return typeof v.userInvocable === 'boolean' && typeof v.agentInvocable === 'boolean';
}

export interface ICustomAgent {

	readonly id: string;
	readonly uri: URI;

	readonly name: string;

	readonly description?: string;

	readonly tools?: readonly string[];

	readonly model?: readonly string[];

	readonly argumentHint?: string;

	readonly target: Target;

	readonly visibility: ICustomAgentVisibility;

	readonly agentInstructions: IChatModeInstructions;

	readonly handOffs?: readonly IHandOff[];

	readonly agents?: readonly string[];

	readonly hooks?: ChatRequestHooks;

	readonly source: IAgentSource;

	readonly sessionTypes?: readonly string[];

	readonly enabled: boolean;
}

export interface IAgentInstructions {
	readonly content: string;
	readonly toolReferences: readonly IVariableReference[];
	readonly metadata?: Record<string, boolean | string | number>;
}

export interface IChatPromptSlashCommand {
	readonly uri: URI;
	readonly name: string;
	readonly type: PromptsType;
	readonly storage: PromptsStorage;
	readonly source?: PromptFileSource;
	readonly description?: string;
	readonly argumentHint?: string;
	readonly userInvocable: boolean;
	readonly extension?: IExtensionDescription;
	readonly pluginUri?: URI;
	readonly pluginLabel?: string;
	readonly sessionTypes?: readonly string[];
}

export interface IResolvedChatPromptSlashCommand extends IChatPromptSlashCommand {
	readonly parsedPromptFile?: ParsedPromptFile;
}


export interface IInstructionFile {
	readonly uri: URI;
	readonly name: string;
	readonly description: string | undefined;
	readonly storage: PromptsStorage;
	readonly pattern: string | undefined;
	readonly extension?: IExtensionDescription;

	readonly pluginUri?: URI;

	readonly source?: PromptFileSource;

	readonly sessionTypes?: readonly string[];
}

export interface IAgentSkill {
	readonly uri: URI;
	readonly storage: PromptsStorage;
	readonly name: string;
	readonly description: string | undefined;
	readonly disableModelInvocation: boolean;
	readonly userInvocable: boolean;
	readonly pluginUri?: URI;
	readonly pluginLabel?: string;
	readonly extension?: IExtensionDescription;
	readonly sessionTypes?: readonly string[];
}

export enum AgentInstructionFileType {
	agentsMd = 'agentsMd',
	claudeMd = 'claudeMd',
	copilotInstructionsMd = 'copilotInstructionsMd',
}

export interface IAgentInstructionFile {
	readonly uri: URI;
	readonly realPath: URI | undefined;
	readonly type: AgentInstructionFileType;
}

export interface Logger {
	logInfo(message: string): void;
}

export type PromptFileSkipReason =
	| 'missing-name'
	| 'missing-description'
	| 'name-mismatch'
	| 'duplicate-name'
	| 'parse-error'
	| 'disabled'
	| 'all-hooks-disabled'
	| 'claude-hooks-disabled'
	| 'workspace-untrusted';

export interface IPromptFileDiscoveryResult {
	readonly status: 'loaded' | 'skipped';
	readonly skipReason?: PromptFileSkipReason;
	readonly errorMessage?: string;
	readonly duplicateOf?: URI;
	readonly promptPath: IPromptPath;
	readonly userInvocable?: boolean;
	readonly disableModelInvocation?: boolean;
}

export interface IPromptSourceFolderResult {
	readonly uri: URI;
	readonly storage: PromptsStorage;
}

export interface IPromptDiscoveryInfo {
	readonly type: PromptsType;
	readonly files: readonly IPromptFileDiscoveryResult[];
	readonly durationInMillis: number;
	readonly sourceFolders?: readonly IPromptSourceFolderResult[];
}

export interface ISlashCommandDiscoveryResult extends IPromptFileDiscoveryResult {
	readonly userInvocable?: boolean;
	readonly argumentHint?: string;
}

export interface ISlashCommandDiscoveryInfo extends IPromptDiscoveryInfo {
	readonly files: readonly ISlashCommandDiscoveryResult[];
}

export interface IInstructionDiscoveryResult extends IPromptFileDiscoveryResult {
	readonly pattern?: string;
}

export interface IInstructionDiscoveryInfo extends IPromptDiscoveryInfo {
	readonly files: readonly IInstructionDiscoveryResult[];
}

export interface IAgentDiscoveryResult extends IPromptFileDiscoveryResult {
	readonly agent?: ICustomAgent;
}

export interface IAgentDiscoveryInfo extends IPromptDiscoveryInfo {
	readonly files: readonly IAgentDiscoveryResult[];
}

export interface IConfiguredHooksInfo {
	readonly hooks: ChatRequestHooks;
	readonly hasDisabledClaudeHooks: boolean;
}

export interface IHookDiscoveryInfo extends IPromptDiscoveryInfo {
	readonly hooksInfo: IConfiguredHooksInfo | undefined;
}

export interface IPromptsService extends IDisposable {
	readonly _serviceBrand: undefined;

	getParsedPromptFile(textModel: ITextModel): ParsedPromptFile;

	listPromptFiles(type: PromptsType, token: CancellationToken): Promise<readonly IPromptPath[]>;

	listPromptFilesForStorage(type: PromptsType, storage: PromptsStorage, token: CancellationToken, root?: URI): Promise<readonly IPromptPath[]>;

	getSourceFolders(type: PromptsType): Promise<readonly IPromptPath[]>;

	getResolvedSourceFolders(type: PromptsType): Promise<readonly IResolvedPromptSourceFolder[]>;

	isValidSlashCommandName(name: string): boolean;

	hasPromptSlashCommand(name: string): boolean;

	resolvePromptSlashCommand(command: string, sessionType: string | undefined, token: CancellationToken): Promise<IResolvedChatPromptSlashCommand | undefined>;

	readonly onDidChangeSlashCommands: Event<void>;

	getPromptSlashCommands(token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]>;

	getPromptSlashCommandName(uri: URI, token: CancellationToken): Promise<string>;

	readonly onDidChangeCustomAgents: Event<void>;

	readonly onDidChangeInstructions: Event<void>;

	readonly onDidChangeAgentInstructions: Event<void>;

	getCustomAgents(token: CancellationToken): Promise<readonly ICustomAgent[]>;

	parseNew(uri: URI, token: CancellationToken): Promise<ParsedPromptFile>;

	registerContributedFile(type: PromptsType, uri: URI, extension: IExtensionDescription, name: string | undefined, description: string | undefined, when?: string, sessionTypes?: readonly string[]): IDisposable;


	getPromptLocationLabel(promptPath: IPromptPath): string;

	listNestedAgentMDs(token: CancellationToken): Promise<IAgentInstructionFile[]>;

	listAgentInstructions(token: CancellationToken, logger?: Logger): Promise<IAgentInstructionFile[]>;

	getVoiceInstructions(token: CancellationToken): Promise<string | undefined>;

	getDictationInstructions(token: CancellationToken): Promise<string | undefined>;

	getAgentFileURIFromModeFile(oldURI: URI): URI | undefined;

	getDisabledPromptFiles(type: PromptsType): ResourceSet;

	setDisabledPromptFiles(type: PromptsType, uris: ResourceSet): void;

	registerPromptFileProvider(extension: IExtensionDescription, type: PromptsType, provider: {
		onDidChangePromptFiles?: Event<void>;
		providePromptFiles: (context: IPromptFileContext, token: CancellationToken) => Promise<IPromptFileResource[] | undefined>;
	}): IDisposable;

	findAgentSkills(token: CancellationToken): Promise<IAgentSkill[] | undefined>;

	readonly onDidChangeSkills: Event<void>;

	readonly onDidChangeHooks: Event<void>;

	getHooks(token: CancellationToken): Promise<IConfiguredHooksInfo | undefined>;

	getInstructionFiles(token: CancellationToken): Promise<readonly IInstructionFile[]>;

	getDiscoveryInfo(type: PromptsType, token: CancellationToken): Promise<IPromptDiscoveryInfo>;
}
