/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findLast } from '../../../../../base/common/arraysFind.js';
import { raceCancellation } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { revive, Revived } from '../../../../../base/common/marshalling.js';
import { IObservable } from '../../../../../base/common/observable.js';
import { equalsIgnoreCase } from '../../../../../base/common/strings.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { Command } from '../../../../../editor/common/languages.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { basename, dirname, extUriBiasedIgnorePathCase, joinPath } from '../../../../../base/common/resources.js';
import { EditorResourceAccessor } from '../../../../common/editor.js';
import { ChatContextKeys } from '../actions/chatContextKeys.js';
import type { IChatAgentEditedFileEvent, IChatProgressHistoryResponseContent, IChatRequestModeInfo, IChatRequestModeInstructions, IChatRequestVariableData, ISerializableChatAgentData } from '../model/chatModel.js';
import { IChatEditingService } from '../editing/chatEditingService.js';
import { ICustomizationHarnessService } from '../customizationHarnessService.js';
import { ChatRequestHooks } from '../promptSyntax/hookSchema.js';
import { isBuiltinSkillUri, getBuiltinSkillContent } from '../promptSyntax/builtin/builtinSkills.js';
import { IRawChatCommandContribution } from './chatParticipantContribTypes.js';
import { IChatFollowup, IChatLocationData, IChatProgress, IChatQuestion as IChatCarouselQuestion, IChatQuestionAnswers, IChatResponseErrorDetails, IChatService, IChatTaskDto, ToolConfirmKind } from '../chatService/chatService.js';
const ITerminalService = createDecorator<any>('terminalService');
import { ILanguageModelToolsService, ToolDataSource, ToolInvocationPresentation, toolContentToA11yString } from '../tools/languageModelToolsService.js';
import type { IToolData } from '../tools/languageModelToolsService.js';
import type { IArtifactRuleOverrides, IChatArtifact } from '../tools/chatArtifactsService.js';
import { IChatArtifactsService } from '../tools/chatArtifactsServiceId.js';
import { TerminalToolId } from '../tools/terminalToolIds.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, ChatPermissionLevel, isAutoApproveLevel } from '../constants.js';
import { ILanguageModelsService } from '../languageModels.js';
import { ChatPerfMark, markChat } from '../chatPerf.js';
import { IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { formatDardcorRouterError, parseDardcorRouterError, parseResetSeconds, cleanMessageText, formatModelDisplayName, diagnoseProviderIssue } from './dardcorRouterError.js';
import { ChatQuestionCarouselData } from '../model/chatProgressTypes/chatQuestionCarouselData.js';
import { ChatPlanReviewData } from '../model/chatProgressTypes/chatPlanReviewData.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITaskService } from '../../../tasks/common/taskService.js';
import { IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { type IChatTodo, IChatTodoListService, normalizeTodoListArgs } from '../tools/chatTodoListService.js';
import { createChatAgentRunState, IChatAgentRunState, IChatAgentRunStateService, updateChatAgentRunState } from '../tools/agentRunStateService.js';
import { commandApprovalKey, compactDardcorAgentMessages, DARDCOR_AGENT_COMPACTION_THRESHOLD_CHARS, detectDardcorLanguage, formatDardcorVerificationLabel, getDardcorAutonomousMomentumDirective, getDardcorAutonomousSelfCorrectionDirective, getDardcorBrowserVerificationRequirement, getDardcorCompletionBlocker, getDardcorEffectivePermissionLevel, getDardcorLanguageName, getDardcorLocaleStrings, getDardcorPlainTextTurnDecision, getDardcorRunGuardReason, getDardcorToolFailureState, getDardcorVerificationCommandStatus, isDardcorAutonomousTask, isDardcorBrowserTest, isDardcorContinuation, isDardcorLowRiskCommand, parseDardcorAgentToolArguments, requiresDardcorToolConfirmation, revalidateDardcorCompletion, summarizeDardcorToolAction } from './dardcorAgentRunPolicy.js';
import { DardcorAgentToolRuntime, formatAgentToolError, isAgentToolExecutionStatus } from '../../../../../platform/agentHost/common/agentToolRuntime.js';
import type { AgentToolExecutionStatus, AgentToolRisk, AgentToolSource } from '../../../../../platform/agentHost/common/agentToolRuntime.js';

type DardcorRouterToolDefinition = {
	type: 'function';
	function: { name: string; description: string; parameters: unknown };
};

function createRouterLocalToolName(tool: IToolData): string {
	const source = tool.source.type.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
	const reference = (tool.toolReferenceName || tool.id).replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 38);
	let hash = 2166136261;
	for (const character of `${tool.source.type}:${tool.id}`) {
		hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	}
	return `dardcor_${source}_${reference}_${(hash >>> 0).toString(36)}`;
}

function computeAgentFileDiff(originalContent: string, modifiedContent: string): { added: number; removed: number } {
	if (originalContent === modifiedContent) {
		return { added: 0, removed: 0 };
	}
	const origLines = originalContent.split(/\r\n|\r|\n/);
	const modLines = modifiedContent.split(/\r\n|\r|\n/);
	const computer = linesDiffComputers.getDefault();
	const diff = computer.computeDiff(origLines, modLines, {
		ignoreTrimWhitespace: false,
		computeMoves: false,
		maxComputationTimeMs: 1000
	});
	let added = 0;
	let removed = 0;
	for (const c of diff.changes) {
		added += Math.max(0, c.modified.endLineNumberExclusive - c.modified.startLineNumber);
		removed += Math.max(0, c.original.endLineNumberExclusive - c.original.startLineNumber);
	}
	return { added, removed };
}

function parseAgentCommandExitCode(output: string): number | undefined {
	const resultMarker = output.match(/\[Command result: exit code (-?\d+)\]/i);
	if (resultMarker) {
		return Number(resultMarker[1]);
	}
	const failure = output.match(/(?:Command failed with exit code|Exit code:)\s*(-?\d+)/i);
	return failure ? Number(failure[1]) : undefined;
}

const ROUTER_PORT = (typeof process !== 'undefined' && process.env?.DARDCOR_PORT) ? Number(process.env.DARDCOR_PORT) : 25128;
const ROUTER_HOSTS = ['127.0.0.1', 'localhost'] as const;
const ROUTER_AUTH_HEADER = { 'Authorization': 'Bearer sk-dardcor-local-key' };

export const DARDCOR_PROVIDER_ALIAS_MAP: Record<string, string> = {
	'codebuddy': 'cbai',
	'codebuddy-intl': 'cbai',
	'codebuddy-cn': 'cbcn',
	'codex': 'cx',
	'openai-codex': 'cx',
	'cline': 'cl',
	'clinepass': 'cl',
	'antigravity': 'ag',
	'qoder': 'qd',
	'qoder-cn': 'qdcn',
	'kilocode': 'kc',
	'kilo-gateway': 'kgw',
	'opencode': 'oc',
	'opencode-go': 'ocg',
	'opencode-zen': 'ocz',
	'github': 'gh',
	'cursor': 'cu',
	'zed': 'zd',
	'gemini-cli': 'gc',
	'grok-cli': 'gcli',
	'grok-build': 'gcli',
	'grok-web': 'gw',
	'perplexity': 'pplx',
	'perplexity-web': 'pw',
	'perplexity-agent': 'pa',
	'mimo-free': 'mmf',
	'xiaomi-mimo': 'mimo',
	'nanobanana': 'nb',
	'cloudflare-ai': 'cf',
	'commandcode': 'cmc',
};

async function fetchRouter(path: string, init?: RequestInit, retries = 4, timeoutMs = 30000): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < retries; attempt++) {
		if (init?.signal?.aborted) {
			throw new Error('Request aborted');
		}
		for (const host of ROUTER_HOSTS) {
			if (init?.signal?.aborted) {
				throw new Error('Request aborted');
			}
			const url = `http://${host}:${ROUTER_PORT}${path}`;
			let timeoutId: any;
			try {
				let signal = init?.signal;
				if (timeoutMs > 0) {
					const controller = new AbortController();
					timeoutId = setTimeout(() => {
						try { controller.abort(new Error(`Router HTTP connect timeout after ${timeoutMs}ms`)); } catch { }
					}, timeoutMs);
					if (init?.signal) {
						if (typeof (AbortSignal as any).any === 'function') {
							signal = (AbortSignal as any).any([init.signal, controller.signal]);
						} else {
							init.signal.addEventListener('abort', () => {
								try { controller.abort(); } catch { }
							}, { once: true });
							signal = controller.signal;
						}
					} else {
						signal = controller.signal;
					}
				}
				const res = await fetch(url, { ...init, signal });
				if (timeoutId) clearTimeout(timeoutId);
				return res;
			} catch (err: any) {
				if (timeoutId) clearTimeout(timeoutId);
				lastErr = err;
				if (init?.signal?.aborted || err?.name === 'AbortError') {
					throw err;
				}
			}
		}
		if (attempt < retries - 1) {
			const delay = Math.min(250 * Math.pow(2, attempt), 1500);
			await new Promise<void>(resolve => setTimeout(resolve, delay));
		}
	}
	throw lastErr;
}

export interface IDardcorRouterModelCapabilities {
	readonly tools?: boolean;
	readonly vision?: boolean;
}

export function normalizeDardcorRouterModelCapabilities(modelInfo: unknown): IDardcorRouterModelCapabilities {
	if (!modelInfo || typeof modelInfo !== 'object') {
		return {};
	}
	const model = modelInfo as Record<string, any>;
	const capabilities = model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : model;
	const tools = typeof capabilities.tools === 'boolean'
		? capabilities.tools
		: typeof model.supports_tools === 'boolean' ? model.supports_tools
			: typeof model.supportsTools === 'boolean' ? model.supportsTools : undefined;
	const inputModalities = Array.isArray(capabilities.inputModalities)
		? capabilities.inputModalities
		: Array.isArray(model.input_modalities) ? model.input_modalities : undefined;
	const vision = typeof capabilities.vision === 'boolean'
		? capabilities.vision
		: typeof capabilities.image === 'boolean' ? capabilities.image
			: inputModalities ? inputModalities.some((modality: unknown) => typeof modality === 'string' && /^(image|vision)$/i.test(modality))
				: undefined;
	const normalized: IDardcorRouterModelCapabilities = {};
	if (tools !== undefined) {
		(normalized as { tools?: boolean }).tools = tools;
	}
	if (vision !== undefined) {
		(normalized as { vision?: boolean }).vision = vision;
	}
	return normalized;
}

const ROUTER_MODELS_CACHE_TTL_MS = 30_000;
const ROUTER_CAPABILITIES_CACHE_TTL_MS = 60_000;
let cachedRouterModelsEntry: { data: any; ts: number } | undefined;
const cachedRouterCapabilitiesMap = new Map<string, { data: IDardcorRouterModelCapabilities; ts: number }>();

async function getCachedRouterModelsData(): Promise<any | undefined> {
	const now = Date.now();
	if (cachedRouterModelsEntry && now - cachedRouterModelsEntry.ts < ROUTER_MODELS_CACHE_TTL_MS) {
		return cachedRouterModelsEntry.data;
	}
	const modelsRes = await fetchRouter('/v1/models', {
		headers: { ...ROUTER_AUTH_HEADER, 'x-dardcor-router-connected-only': '1', 'x-drouter-connected-only': '1' }
	}, 2, 8000);
	if (modelsRes.ok) {
		const data = await modelsRes.json();
		if (Array.isArray(data?.data) && data.data.length > 0) {
			cachedRouterModelsEntry = { data, ts: Date.now() };
		}
		return data;
	}
	return cachedRouterModelsEntry?.data;
}

async function getCachedRouterModelCapabilities(modelName: string): Promise<IDardcorRouterModelCapabilities> {
	const now = Date.now();
	const cached = cachedRouterCapabilitiesMap.get(modelName);
	if (cached && now - cached.ts < ROUTER_CAPABILITIES_CACHE_TTL_MS) {
		return cached.data;
	}
	const capabilityResponse = await fetchRouter(`/v1/models/info?id=${encodeURIComponent(modelName)}`, {
		headers: ROUTER_AUTH_HEADER
	}, 1, 5000);
	if (capabilityResponse.ok) {
		const caps = normalizeDardcorRouterModelCapabilities(await capabilityResponse.json());
		cachedRouterCapabilitiesMap.set(modelName, { data: caps, ts: Date.now() });
		return caps;
	}
	return cached?.data ?? {};
}

export function shouldAttachDardcorBrowserScreenshot(capabilities: IDardcorRouterModelCapabilities): boolean {
	return capabilities.vision === true;
}

export function isDardcorRouterStreamTerminal(event: unknown): boolean {
	if (!event || typeof event !== 'object') {
		return false;
	}
	const payload = event as Record<string, any>;
	if (payload.done === true || /^(?:message_stop|message_end|response\.completed|response\.done|stream_end)$/i.test(String(payload.type ?? ''))) {
		return true;
	}
	const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
	return choice?.finish_reason !== undefined && choice.finish_reason !== null
		|| choice?.delta?.finish_reason !== undefined && choice.delta.finish_reason !== null;
}

export function isDardcorNativeToolCompatibilityError(status: number, errorText: string): boolean {
	return (status === 400 || status === 422)
		&& /(?:tool_choice|tools|function_call|functions).*(?:unsupported|not supported|does not support|invalid|unknown|unrecognized|required|not allowed)|(?:unsupported|not supported|does not support|invalid|unknown|unrecognized|required|not allowed).*(?:tool_choice|tools|function_call|functions)/i.test(errorText);
}

export function isDardcorMaxTokensCompatibilityError(status: number, errorText: string): boolean {
	return (status === 400 || status === 422)
		&& /(?:max_tokens|unsupported_parameter).*(?:unsupported|not supported|unknown|invalid|not allowed)|(?:unsupported|not supported|unknown|invalid|not allowed).*(?:max_tokens|unsupported_parameter)/i.test(errorText);
}


export interface IChatAgentHistoryEntry {
	request: IChatAgentRequest;
	response: ReadonlyArray<IChatProgressHistoryResponseContent | IChatTaskDto>;
	result: IChatAgentResult;
}

export interface IChatAgentAttachmentCapabilities {
	supportsFileAttachments?: boolean;
	supportsToolAttachments?: boolean;
	supportsMCPAttachments?: boolean;
	supportsImageAttachments?: boolean;
	supportsSearchResultAttachments?: boolean;
	supportsInstructionAttachments?: boolean;
	supportsSourceControlAttachments?: boolean;
	supportsProblemAttachments?: boolean;
	supportsSymbolAttachments?: boolean;
	supportsTerminalAttachments?: boolean;
	supportsPromptAttachments?: boolean;
	supportsHandOffs?: boolean;
	supportsCheckpoints?: boolean;
	terminalCommandPrefix?: string;
}

export interface IChatAgentData {
	id: string;
	name: string;
	fullName?: string;
	description?: string;
	when?: string;
	extensionId: ExtensionIdentifier;
	extensionVersion: string | undefined;
	extensionPublisherId: string;
	publisherDisplayName?: string;
	extensionDisplayName: string;
	isDefault?: boolean;
	isDynamic?: boolean;
	isCore?: boolean;
	canAccessPreviousChatHistory?: boolean;
	metadata: IChatAgentMetadata;
	slashCommands: IChatAgentCommand[];
	locations: ChatAgentLocation[];
	modes: ChatModeKind[];
	disambiguation: { category: string; description: string; examples: string[] }[];
	capabilities?: IChatAgentAttachmentCapabilities;
}

export interface IChatWelcomeMessageContent {
	icon: ThemeIcon;
	title: string;
	message: IMarkdownString;
}

export interface IChatAgentImplementation {
	invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult>;
	setRequestTools?(requestId: string, tools: UserSelectedTools): void;
	setYieldRequested?(requestId: string, value: boolean): void;
	provideFollowups?(request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]>;
	provideChatTitle?: (history: IChatAgentHistoryEntry[], token: CancellationToken) => Promise<string | undefined>;
	provideChatSummary?: (history: IChatAgentHistoryEntry[], token: CancellationToken) => Promise<string | undefined>;
}

export interface IChatParticipantDetectionResult {
	participant: string;
	command?: string;
}

export interface IChatParticipantMetadata {
	participant: string;
	command?: string;
	disambiguation: { category: string; description: string; examples: string[] }[];
}

export interface IChatParticipantDetectionProvider {
	provideParticipantDetection(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], options: { location: ChatAgentLocation; participants: IChatParticipantMetadata[] }, token: CancellationToken): Promise<IChatParticipantDetectionResult | null | undefined>;
}

export type IChatAgent = IChatAgentData & IChatAgentImplementation;

export interface IChatAgentCommand extends IRawChatCommandContribution {
	followupPlaceholder?: string;
}

export interface IChatAgentMetadata {
	helpTextPrefix?: string | IMarkdownString;
	helpTextPostfix?: string | IMarkdownString;
	icon?: URI;
	iconDark?: URI;
	themeIcon?: ThemeIcon;
	sampleRequest?: string;
	supportIssueReporting?: boolean;
	followupPlaceholder?: string;
	isSticky?: boolean;
	additionalWelcomeMessage?: string | IMarkdownString;
}

export type UserSelectedTools = Record<string, boolean>;


export interface IChatAgentRequest {
	sessionResource: URI;
	requestId: string;
	agentId: string;
	command?: string;
	message: string;
	attempt?: number;
	enableCommandDetection?: boolean;
	isParticipantDetected?: boolean;
	variables: IChatRequestVariableData;
	location: ChatAgentLocation;
	locationData?: Revived<IChatLocationData>;
	acceptedConfirmationData?: unknown[];
	rejectedConfirmationData?: unknown[];
	agentHostSessionConfig?: Record<string, unknown>;
	userSelectedModelId?: string;
	modelConfiguration?: IStringDictionary<unknown>;
	userSelectedTools?: UserSelectedTools;
	modeInstructions?: IChatRequestModeInstructions;
	modeInfo?: IChatRequestModeInfo;
	editedFileEvents?: IChatAgentEditedFileEvent[];
	workingDirectory?: URI;
	hooks?: ChatRequestHooks;
	hasHooksEnabled?: boolean;
	isVoiceModeInput?: boolean;
	permissionLevel?: ChatPermissionLevel;
	subAgentInvocationId?: string;
	subAgentName?: string;
	parentRequestId?: string;

	isSystemInitiated?: boolean;

	hideFromTranscript?: boolean;
}

export interface IChatQuestion {
	readonly prompt: string;
	readonly participant?: string;
	readonly command?: string;
}

export interface IChatAgentResultTimings {
	firstProgress?: number;
	totalElapsed: number;
}

export interface IChatAgentResult {
	errorDetails?: IChatResponseErrorDetails;
	timings?: IChatAgentResultTimings;
	readonly metadata?: { readonly [key: string]: unknown };
	readonly details?: string;
	nextQuestion?: IChatQuestion;
}

export const IChatAgentService = createDecorator<IChatAgentService>('chatAgentService');

interface IChatAgentEntry {
	data: IChatAgentData;
	impl?: IChatAgentImplementation;
}

export interface IChatAgentCompletionItem {
	id: string;
	name?: string;
	fullName?: string;
	icon?: ThemeIcon;
	value: unknown;
	command?: Command;
}

export interface IChatAgentInvocationEvent {
	readonly agentId: string;
	readonly request: Readonly<IChatAgentRequest>;
}

export interface IChatAgentService {
	_serviceBrand: undefined;
	readonly onDidChangeAgents: Event<IChatAgent | undefined>;
	readonly onWillInvokeAgent: Event<IChatAgentInvocationEvent>;
	readonly hasToolsAgent: boolean;
	registerAgent(id: string, data: IChatAgentData): IDisposable;
	registerAgentImplementation(id: string, agent: IChatAgentImplementation): IDisposable;
	registerDynamicAgent(data: IChatAgentData, agentImpl: IChatAgentImplementation): IDisposable;
	registerAgentCompletionProvider(id: string, provider: (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>): IDisposable;
	getAgentCompletionItems(id: string, query: string, token: CancellationToken): Promise<IChatAgentCompletionItem[]>;
	registerChatParticipantDetectionProvider(handle: number, provider: IChatParticipantDetectionProvider): IDisposable;
	detectAgentOrCommand(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], options: { location: ChatAgentLocation }, token: CancellationToken): Promise<{ agent: IChatAgentData; command?: IChatAgentCommand } | undefined>;
	hasChatParticipantDetectionProviders(): boolean;
	invokeAgent(agent: string, request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult>;
	setRequestTools(agent: string, requestId: string, tools: UserSelectedTools): void;
	setYieldRequested(agent: string, requestId: string, value: boolean): void;
	getFollowups(id: string, request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]>;
	getChatTitle(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined>;
	getChatSummary(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined>;
	getAgent(id: string, includeDisabled?: boolean): IChatAgentData | undefined;
	getAgentByFullyQualifiedId(id: string): IChatAgentData | undefined;
	getAgents(): IChatAgentData[];
	getActivatedAgents(): Array<IChatAgent>;
	getAgentsByName(name: string): IChatAgentData[];
	agentHasDupeName(id: string): boolean;

	getDefaultAgent(location: ChatAgentLocation, mode?: ChatModeKind): IChatAgent | undefined;

	getContributedDefaultAgent(location: ChatAgentLocation): IChatAgentData | undefined;
	updateAgent(id: string, updateMetadata: IChatAgentMetadata): void;
}

export interface IWorkspaceSnapshot {
	hasWorkspace: boolean;
	projectName: string;
	rootPath: string;
	rootUri?: URI;
	techStack: string;
	fileTree: string;
	activeFile?: string;
	activeFileExcerpt?: string;
	openBrowserPages?: string[];
}

export const DARDCOR_AGENT_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read the contents of a file in the workspace with line numbers.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to read (e.g. "src/App.tsx" or "package.json")' },
					startLine: { type: 'number', description: 'Optional starting line number (1-based)' },
					endLine: { type: 'number', description: 'Optional ending line number (1-based)' }
				},
				required: ['filePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description: 'Create a new file or overwrite an existing file in the workspace with complete content.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to write' },
					content: { type: 'string', description: 'Full content of the file' }
				},
				required: ['filePath', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'edit_file',
			description: 'Replace a specific snippet of code/text in a file with new code.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to edit' },
					searchContent: { type: 'string', description: 'Exact string in the file to find and replace' },
					replaceContent: { type: 'string', description: 'New string to replace it with' }
				},
				required: ['filePath', 'searchContent', 'replaceContent']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_directory',
			description: 'List all files and subdirectories within a directory in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					dirPath: { type: 'string', description: 'Relative path of the directory (leave empty or "." for project root)' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'find_files',
			description: 'Find files in the workspace matching a pattern or extension (e.g. "*.tsx", "src/components/*").',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Filename or glob pattern to search for' }
				},
				required: ['pattern']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_code',
			description: 'Search for text or keyword across files in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search term or keyword' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_in_terminal',
			description: 'Run a shell command in the workspace integrated terminal (e.g. "npm run build", "npm test", "npm run dev"). Runs in Windows PowerShell on Windows or bash/zsh on Linux/macOS.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Command line string to execute in the integrated terminal' },
					commandLine: { type: 'string', description: 'Alternative parameter name for the command string' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_command',
			description: 'Run a shell command in the workspace integrated terminal (e.g. "npm run build", "npm test", "npm run dev"). Runs in Windows PowerShell on Windows or bash/zsh on Linux/macOS.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Command line string to execute in the integrated terminal' },
					commandLine: { type: 'string', description: 'Alternative parameter name for the command string' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'send_to_terminal',
			description: 'Send input or text to an active integrated terminal.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'Text or input string to send to the terminal' }
				},
				required: ['text']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_terminal_output',
			description: 'Get the latest output text from the active integrated terminal.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'kill_terminal',
			description: 'Terminate the active integrated terminal process.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'manage_todo_list',
			description: 'Manage and update the structured task checklist to track plan progress throughout the coding session.',
			parameters: {
				type: 'object',
				properties: {
					todoList: {
						type: 'array',
						description: 'Complete list of todo items with their current statuses',
						items: {
							type: 'object',
							properties: {
								id: { type: 'number', description: 'Unique identifier number starting from 1' },
								title: { type: 'string', description: 'Concise task description' },
								status: { type: 'string', enum: ['not-started', 'in-progress', 'completed'] }
							},
							required: ['id', 'title', 'status']
						}
					}
				},
				required: ['todoList']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'fetch_web_page',
			description: 'Fetch content or documentation from a web URL.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'HTTP or HTTPS web URL to fetch' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'delete_file',
			description: 'Delete a file or folder in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file or folder to delete' },
					recursive: { type: 'boolean', description: 'Recursively delete directory contents if target is a folder (default true)' }
				},
				required: ['filePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'rename_file',
			description: 'Rename or move a file or folder in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					oldFilePath: { type: 'string', description: 'Current relative path of the file or folder' },
					newFilePath: { type: 'string', description: 'New relative path of the file or folder' },
					overwrite: { type: 'boolean', description: 'Whether to overwrite destination if it exists (default false)' }
				},
				required: ['oldFilePath', 'newFilePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_diagnostics',
			description: 'Get compiler, linter, TypeScript, or syntax problems (errors, warnings) in a specific file or across the entire workspace.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Optional relative path of the file to inspect. If omitted, returns all workspace diagnostics.' },
					severity: { type: 'string', enum: ['error', 'warning', 'all'], description: 'Filter problems by severity (default "all")' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_file_outline',
			description: 'Extract functions, classes, methods, interfaces, types, exports, and code structure of a file.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to inspect' }
				},
				required: ['filePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'grep_search',
			description: 'Fast regex or substring pattern search across files in the workspace with line numbers.',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Text or regular expression pattern to search for' },
					subPath: { type: 'string', description: 'Optional subfolder or file to limit search to (e.g. "src" or "app")' },
					isRegex: { type: 'boolean', description: 'Whether to treat pattern as a regular expression (default false)' },
					caseInsensitive: { type: 'boolean', description: 'Whether to ignore case (default true)' }
				},
				required: ['pattern']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'terminal_selection',
			description: 'Get the current highlighted or selected text in the active terminal.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'terminal_last_command',
			description: 'Get the last command executed in the active terminal, its output, working directory, and exit code.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_and_run_task',
			description: 'Run a background service, dev server, or build command in a dedicated terminal instance (clean execution, does not create or write tasks.json files on disk).',
			parameters: {
				type: 'object',
				properties: {
					label: { type: 'string', description: 'Name of the task to create and run' },
					type: { type: 'string', description: 'Task type (e.g. "shell" or "process")' },
					command: { type: 'string', description: 'Command line for the task' },
					args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
					isBackground: { type: 'boolean', description: 'Whether the task runs continuously in the background' }
				},
				required: ['label', 'command']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_task_output',
			description: 'Get the terminal output of a running task by label or ID.',
			parameters: {
				type: 'object',
				properties: {
					taskLabel: { type: 'string', description: 'Label or name of the task' }
				},
				required: ['taskLabel']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_task',
			description: 'Run an existing task configured in tasks.json by its label.',
			parameters: {
				type: 'object',
				properties: {
					taskLabel: { type: 'string', description: 'Label of the configured task to execute' }
				},
				required: ['taskLabel']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'ask_questions',
			description: 'Ask the user clarifying questions with multiple-choice options or open feedback before proceeding.',
			parameters: {
				type: 'object',
				properties: {
					questions: {
						type: 'array',
						description: 'List of questions to ask the user',
						items: {
							type: 'object',
							properties: {
								header: { type: 'string', description: 'Short header/tag for the question' },
								question: { type: 'string', description: 'The question text to display' },
								multiSelect: { type: 'boolean', description: 'Whether multiple options can be chosen' },
								options: {
									type: 'array',
									description: 'Predefined options for the user to choose from',
									items: {
										type: 'object',
										properties: {
											label: { type: 'string', description: 'Option text' },
											description: { type: 'string', description: 'Explanation of the option' },
											recommended: { type: 'boolean', description: 'Whether this is the recommended choice' }
										},
										required: ['label']
									}
								}
							},
							required: ['header', 'question']
						}
					}
				},
				required: ['questions']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'review_plan',
			description: 'Present a structured implementation plan to the user for approval or review before executing changes.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Title of the plan' },
					content: { type: 'string', description: 'Markdown body containing the step-by-step plan' },
					actions: {
						type: 'array',
						description: 'Available user response actions (e.g. "Approve and proceed", "Revise plan")',
						items: {
							type: 'object',
							properties: {
								label: { type: 'string', description: 'Action button label' },
								description: { type: 'string', description: 'Optional explanation' },
								default: { type: 'boolean', description: 'Whether this is the default action' }
							},
							required: ['label']
						}
					}
				},
				required: ['content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_subagent',
			description: 'Delegate a focused autonomous sub-task to a specialized subagent (e.g. codebase research, code search, or test execution).',
			parameters: {
				type: 'object',
				properties: {
					prompt: { type: 'string', description: 'Detailed prompt instructions for the subagent' },
					description: { type: 'string', description: 'Short description of what the subagent is doing' },
					subagentType: { type: 'string', description: 'Type of subagent (e.g. "research", "code_review", "test_runner")' }
				},
				required: ['prompt', 'description']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'confirm_terminal_command',
			description: 'Ask for explicit user confirmation with Allow/Skip buttons before executing a terminal command.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'The terminal command line' },
					explanation: { type: 'string', description: 'Explanation of what the command does' },
					goal: { type: 'string', description: 'Goal or purpose of running the command' }
				},
				required: ['command', 'explanation']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_artifacts',
			description: 'Save or update session artifacts (e.g. devServer URLs, plans, documents, or screenshots) so the user can easily access and view them in the artifact panel.',
			parameters: {
				type: 'object',
				properties: {
					artifacts: {
						type: 'array',
						description: 'The list of artifacts for this session',
						items: {
							type: 'object',
							properties: {
								label: { type: 'string', description: 'Display label for the artifact' },
								uri: { type: 'string', description: 'URI of the artifact (e.g. "http://localhost:3000" or file path)' },
								type: { type: 'string', enum: ['devServer', 'screenshot', 'plan'], description: 'Type of artifact' }
							},
							required: ['label']
						}
					}
				},
				required: ['artifacts']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_artifact_rules',
			description: 'Configure rules for automatically surfacing files, outputs, and logs as session artifacts.',
			parameters: {
				type: 'object',
				properties: {
					byFilePath: { type: 'object', description: 'Glob pattern mappings for files to surface as artifacts' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'open_browser_page',
			description: 'Open or focus a browser page/tab in the Dardcor Code Integrated Browser at the given URL (e.g. "http://localhost:3000" or "http://127.0.0.1:8000"), show the Dardcor cursor, and return the interactive DOM snapshot.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'The URL to open (e.g. "http://localhost:3000", "http://127.0.0.1:8000", or file URL)' },
					forceNew: { type: 'boolean', description: 'Whether to force opening a new browser tab even if one is already open' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_browser_page',
			description: 'Inspect the active Integrated Browser page. Indexes all interactive elements (buttons, links, inputs, selects, tabs) with Set-of-Mark IDs [1..N], and returns the page title, URL, scroll position, interactive element map, visible text content, and runtime/console errors.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID or URL substring of the browser tab to read' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_page',
			description: 'Alias for read_browser_page: get a complete interactive DOM snapshot and console diagnostics of the active browser page.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'navigate_browser',
			description: 'Navigate the active Integrated Browser tab to a new URL, wait for DOM stability, and return the updated interactive DOM snapshot.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'Destination URL to navigate to' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'navigate_page',
			description: 'Alias for navigate_browser: navigate the integrated browser to a new URL.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'Destination URL to navigate to' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'click_element',
			description: 'Move the Dardcor cursor to a unique target, highlight and click it through Playwright actionability checks, wait for the page, and return the updated DOM snapshot.',
			parameters: {
				type: 'object',
				properties: {
					ref: { type: 'string', description: 'Deterministic accessibility tree ref from read_browser_page (e.g. "@e1", "@e2"). Recommended targeting method.' },
					elementId: { type: 'string', description: 'Deterministic ref (e.g. "@e1") or Set-of-Mark numeric ID from read_browser_page (e.g. "3" for [3]) or DOM id' },
					selector: { type: 'string', description: 'CSS selector (e.g. "button.add-to-cart", "#submit") or visible button/link text (e.g. "Tambah ke Keranjang", "Beli Sekarang")' },
					text: { type: 'string', description: 'Visible text, aria-label, or placeholder of the element to click' },
					x: { type: 'number', description: 'Optional exact viewport X coordinate to click' },
					y: { type: 'number', description: 'Optional exact viewport Y coordinate to click' },
					doubleClick: { type: 'boolean', description: 'Set true to perform a double-click' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'type_in_page',
			description: 'Move the Dardcor cursor to an input/textarea field, focus it, type text through Playwright keyboard input, optionally press Enter, and return the updated DOM snapshot.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'The text string to type into the field' },
					ref: { type: 'string', description: 'Deterministic accessibility tree ref from read_browser_page (e.g. "@e1", "@e2"). Recommended targeting method.' },
					elementId: { type: 'string', description: 'Deterministic ref (e.g. "@e2") or Set-of-Mark numeric ID from read_browser_page (e.g. "2" for [2]) or DOM id' },
					selector: { type: 'string', description: 'CSS selector or placeholder/label text of the input field (e.g. "input[name=q]", "Cari produk...")' },
					clearFirst: { type: 'boolean', description: 'Whether to clear existing input value before typing (default: true)' },
					pressEnter: { type: 'boolean', description: 'Whether to press the Enter key after typing to submit search/form (default: false)' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['text']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'scroll_browser_page',
			description: 'Scroll the active browser page (down, up, top, bottom, left, right) or scroll directly to a specific element, and return the newly visible interactive elements.',
			parameters: {
				type: 'object',
				properties: {
					direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom', 'left', 'right'], description: 'Scroll direction (default: "down")' },
					amount: { type: 'number', description: 'Scroll distance in pixels (default: 550)' },
					selector: { type: 'string', description: 'Optional CSS selector or text of an element to scroll into view' },
					ref: { type: 'string', description: 'Optional accessibility tree ref (e.g. "@e1") of an element to scroll into view' },
					elementId: { type: 'string', description: 'Optional deterministic ref (e.g. "@e1") or numeric ID of an element to scroll into view' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'hover_element',
			description: 'Move the Dardcor cursor over a target element and use Playwright hover to reveal dropdown menus, tooltips, or hover states.',
			parameters: {
				type: 'object',
				properties: {
					ref: { type: 'string', description: 'Deterministic accessibility tree ref from read_browser_page (e.g. "@e1", "@e5"). Recommended targeting method.' },
					elementId: { type: 'string', description: 'Deterministic ref (e.g. "@e5") or numeric ID from read_browser_page (e.g. "5")' },
					selector: { type: 'string', description: 'CSS selector or visible text of the element to hover' },
					text: { type: 'string', description: 'Visible text of the element to hover' },
					x: { type: 'number', description: 'Optional viewport X coordinate' },
					y: { type: 'number', description: 'Optional viewport Y coordinate' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'press_key',
			description: 'Press a keyboard key (e.g. "Enter", "Escape", "Tab", "Backspace", "ArrowDown", "ArrowUp", "Space") in the active browser page.',
			parameters: {
				type: 'object',
				properties: {
					key: { type: 'string', description: 'Key name such as "Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "Backspace", "Space"' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['key']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'select_option',
			description: 'Select an option in a <select> dropdown element on the active browser page by value, visible option text/label, or 0-based index.',
			parameters: {
				type: 'object',
				properties: {
					ref: { type: 'string', description: 'Deterministic accessibility tree ref of the <select> element (e.g. "@e6"). Recommended targeting method.' },
					elementId: { type: 'string', description: 'Deterministic ref (e.g. "@e6") or numeric ID of the <select> element' },
					selector: { type: 'string', description: 'CSS selector or label of the <select> element' },
					value: { type: 'string', description: 'Option value or visible text to select' },
					optionText: { type: 'string', description: 'Visible text of the option to select' },
					index: { type: 'number', description: '0-based option index to select' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'drag_and_drop',
			description: 'Move the Dardcor cursor while dragging an element from its source to a target on the browser page.',
			parameters: {
				type: 'object',
				properties: {
					sourceRef: { type: 'string', description: 'Source element ref from snapshot (e.g. "@e1") to drag' },
					sourceElementId: { type: 'string', description: 'Source element ref (e.g. "@e1") or Set-of-Mark ID to drag' },
					sourceSelector: { type: 'string', description: 'CSS selector or text of the element to drag' },
					targetRef: { type: 'string', description: 'Target element ref from snapshot (e.g. "@e2") to drop onto' },
					targetElementId: { type: 'string', description: 'Target element ref (e.g. "@e2") or Set-of-Mark ID to drop onto' },
					targetSelector: { type: 'string', description: 'CSS selector or text of the drop target element' },
					sourceX: { type: 'number', description: 'Optional starting X coordinate' },
					sourceY: { type: 'number', description: 'Optional starting Y coordinate' },
					targetX: { type: 'number', description: 'Optional destination X coordinate' },
					targetY: { type: 'number', description: 'Optional destination Y coordinate' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'wait_for_browser',
			description: 'Wait for a specific CSS selector or text to appear on the browser page, or wait for DOM/network stability.',
			parameters: {
				type: 'object',
				properties: {
					selector: { type: 'string', description: 'Optional CSS selector to wait for' },
					text: { type: 'string', description: 'Optional visible text substring to wait for on the page' },
					timeoutMs: { type: 'number', description: 'Maximum time to wait in milliseconds (default: 5000)' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'execute_browser_script',
			description: 'Execute custom JavaScript code directly inside the active browser page context via CDP Runtime.evaluate and return the result along with an updated DOM snapshot.',
			parameters: {
				type: 'object',
				properties: {
					script: { type: 'string', description: 'JavaScript expression or function body to evaluate inside the browser page' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['script']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_browser_console_logs',
			description: 'Retrieve all captured console logs, warnings, uncaught runtime exceptions, unhandled promise rejections, and dialog messages from the active browser tab.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'handle_browser_dialog',
			description: 'Accept or dismiss a browser JavaScript dialog (alert, confirm, prompt) and configure automatic dialog handling policy.',
			parameters: {
				type: 'object',
				properties: {
					accept: { type: 'boolean', description: 'Whether to accept/OK (true) or cancel/dismiss (false) the dialog' },
					promptText: { type: 'string', description: 'Optional text to enter into a prompt() dialog' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'screenshot_browser_page',
			description: 'Capture a live screenshot of the integrated browser page and return the full interactive DOM snapshot.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'screenshot_page',
			description: 'Alias for screenshot_browser_page: capture a live screenshot of the integrated browser page.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'task_completed',
			description: 'Request completion review after all checklist items are complete and actual verification has succeeded. Include a clear, concise user-facing conclusion in the user’s language describing the actual outcome and key work. Runtime completion checks can reject this request; it does not itself mark the task complete.',
			parameters: {
				type: 'object',
				properties: {
					summary: { type: 'string', description: 'Clear final conclusion in the user’s language: what was accomplished, the key changes, current project state, and any remaining limitations. Do not claim unverified work.' },
					verificationSteps: { type: 'string', description: 'Commands and verification steps for the developer to run and test the application' },
					filesChanged: {
						type: 'array',
						items: { type: 'string' },
						description: 'List of all files created, modified, or deleted'
					}
				},
				required: ['summary']
			}
		}
	}
];

const DARDCOR_BROWSER_VERIFICATION_TOOL_NAMES = new Set([
	'open_browser_page', 'read_browser_page', 'read_page', 'navigate_browser', 'navigate_page',
	'click_element', 'click_browser', 'type_in_page', 'type_browser', 'scroll_browser_page', 'scroll_page',
	'hover_element', 'hover_browser', 'press_key', 'select_option', 'drag_and_drop', 'wait_for_browser',
	'execute_browser_script', 'get_browser_console_logs', 'handle_browser_dialog',
	'screenshot_browser_page', 'screenshot_page',
]);

export interface IDardcorSystemPromptOptions {
	readonly userPrompt?: string;
	readonly permissionLevel?: string;
	readonly activeSkills?: readonly { name: string; description?: string; body: string }[];
	readonly todos?: readonly IChatTodo[];
}

export function buildDardcorSystemPrompt(snapshot: IWorkspaceSnapshot, options?: IDardcorSystemPromptOptions): string {
	const lang = detectDardcorLanguage(options?.userPrompt);
	const langName = getDardcorLanguageName(lang);
	const isFullAccess = options?.permissionLevel === 'autoApprove';

	const browserContextLine = snapshot.openBrowserPages && snapshot.openBrowserPages.length > 0
		? `\n- Active Integrated Browser Tabs:\n${snapshot.openBrowserPages.map((p, i) => `  [${i + 1}] ${p}`).join('\n')}`
		: '\n- Active Integrated Browser Tabs: None currently open (use `open_browser_page` to launch one)';

	// Dynamic Language & Identity Persona
	let personaBlock: string;
	if (lang === 'id') {
		personaBlock = `=== IDENTITAS DAN PERAN UTAMA ===
Anda adalah Dardcor Code, AI Software Engineer elit kelas dunia yang terintegrasi langsung di dalam Dardcor Code Editor.
Dibuat dan dikembangkan secara eksklusif oleh Dardcor Corporation.
Selalu identifikasi diri Anda secara tegas sebagai Dardcor Code.
JANGAN PERNAH menyatakan diri Anda sebagai Provider, OpenAI, Anthropic, Claude, atau model pihak ketiga manapun.
Bantu pengembang dengan keahlian mendalam dalam pemrograman, debugging, arsitektur sistem, refactoring, dan pengujian software otomatis.

=== PENYESUAIAN BAHASA OTOMATIS (MULTILINGUAL SYNCHRONIZATION) ===
Bahasa Pengguna Terdeteksi: ${langName} (Bahasa Indonesia).
WAJIB: Anda HARUS berpikir, menjelaskan konsep, menulis reasoning, merespons, dan mengisi SEMUA argumen alat yang berhadapan dengan pengguna ('explanation', 'goal', 'title', 'summary', 'description', 'taskLabel') dalam BAHASA INDONESIA secara alami, profesional, dan fasih.
Jangan pernah beralih ke bahasa Inggris kecuali diminta secara eksplisit atau untuk kode program, path file, dan sintaksis teknis standar.`;
	} else if (lang === 'ja') {
		personaBlock = `=== アイデンティティとコアロール ===
あなたはDardcor Codeです。Dardcor Code Editorに直接組み込まれた世界最高峰のAIソフトウェアエンジニアです。
Dardcor Corporationによって開発されました。
自己紹介やモデルを問われた際は、常にDardcor Codeと名乗ってください。
Provider、OpenAI、Anthropic、Claudeなどのサードパーティモデルであると名乗ることは絶対に避けてください。

=== 自動言語検出と完全多言語同期 ===
検出されたユーザー言語：${langName}。
必須指令：思考プロセス、概念説明、質問、およびツールのユーザー向け引数（'explanation', 'goal', 'title', 'summary', 'description', 'taskLabel' など）は、すべて自然で流暢な日本語で作成してください。コード構文やファイルパス以外の回答で英語を強制しないでください。`;
	} else if (lang === 'zh') {
		personaBlock = `=== 身份与核心定位 ===
您是 Dardcor Code，深度集成于 Dardcor Code 编辑器中的世界顶级 AI 软件工程师。
由 Dardcor Corporation 研发。
当被问及身份、模型或背景时，必须明确表明您是 Dardcor Code。
严禁声称自己是 Provider、OpenAI、Anthropic、Claude 或任何第三方模型。

=== 全球多语言自动同步 ===
检测到的用户语言：${langName}。
强制规则：您必须全程使用中文进行思考、分析、解答，并确保所有面向用户的工具参数（如 'explanation', 'goal', 'title', 'summary', 'description', 'taskLabel'）均使用纯正地道的中文。除标准代码语法、文件路径和技术专有名词外，严禁混杂英文描述。`;
	} else if (lang === 'es') {
		personaBlock = `=== IDENTIDAD Y ROL PRINCIPAL ===
Eres Dardcor Code, un ingeniero de software de IA de élite integrado directamente en el editor Dardcor Code.
Desarrollado exclusivamente por Dardcor Corporation.
Identifícate siempre claramente como Dardcor Code.
NUNCA afirmes ser Provider, OpenAI, Anthropic, Claude ni ningún modelo de terceros.

=== DETECCIÓN DINÁMICA DE IDIOMA Y PARIDAD MULTILINGÜE ===
Idioma del usuario detectado: ${langName}.
OBLIGATORIO: Debes razonar, explicar y formular todos los argumentos descriptivos de herramientas ('explanation', 'goal', 'title', 'summary', 'description', 'taskLabel') y respuestas en ESPAÑOL de manera natural y precisa.`;
	} else {
		personaBlock = `=== IDENTITY AND CORE ROLE ===
You are Dardcor Code, an elite, state-of-the-art AI Software Engineer built directly into the Dardcor Code Editor.
Created exclusively by Dardcor Corporation.
Always identify yourself as Dardcor Code when asked about your identity or model.
Never claim to be Provider, OpenAI, Anthropic, Claude, or any third-party model.
Assist developers with coding, debugging, architecture, refactoring, and software development with precision and depth.

=== UNIVERSAL DYNAMIC LANGUAGE ADAPTATION ===
Detected User Language: ${langName}.
MANDATORY DIRECTIVE: Automatically synchronize with the developer's language (${langName}). You MUST construct all reasoning, greetings, explanations, and user-facing tool arguments ('explanation', 'goal', 'title', 'summary', 'description', 'taskLabel') naturally and fluently in ${langName}. Keep technical code syntax, file paths, and identifiers in standard syntax.`;
	}

	// Dynamic Workspace & Stack Intelligence
	let stackSpecialization = '';
	const combinedStackInfo = `${snapshot.techStack} ${snapshot.projectName} ${snapshot.fileTree}`.toLowerCase();

	if (/laravel|artisan|composer\.json|blade|\.blade\.php/i.test(combinedStackInfo)) {
		stackSpecialization += `\n- [Framework Specialization: Laravel & PHP]
  * Follow Laravel idiomatic conventions and MVC structure.
  * Execute artisan commands via 'run_command' (e.g. \`php artisan migrate\`, \`php artisan route:list\`, \`php artisan test\`).
  * Verify frontend assets via Vite (\`npm run build\`).
  * Never invent non-standard directories outside the Laravel directory structure.`;
	}
	if (/next(?:\.js)?|react|tailwind|jsx|tsx/i.test(combinedStackInfo)) {
		stackSpecialization += `\n- [Framework Specialization: React / Next.js]
  * Respect App Router or Pages Router conventions.
  * Explicitly add \`"use client"\` at the top of client components that consume React hooks, event listeners, or browser APIs.
  * Leverage modern Tailwind CSS utility classes and ensure responsive layouts.
  * Verify compile-time type safety with TypeScript and 'npm run build'.`;
	}
	if (/vue|nuxt/i.test(combinedStackInfo)) {
		stackSpecialization += `\n- [Framework Specialization: Vue / Nuxt]
  * Use Single File Components with \`<script setup lang="ts">\` and Composition API.
  * Use Pinia for state management and Vue Router for navigation.`;
	}
	if (/python|django|fastapi|flask/i.test(combinedStackInfo)) {
		stackSpecialization += `\n- [Framework Specialization: Python]
  * Adhere to PEP 8 standards and modern type annotations.
  * Run test suites with pytest via 'run_command'.`;
	}
	if (/rust|cargo/i.test(combinedStackInfo)) {
		stackSpecialization += `\n- [Framework Specialization: Rust]
  * Adhere to idiomatic Rust ownership and Result/Option error handling.
  * Validate compilation with \`cargo check\` and run test suites with \`cargo test\`.`;
	}

	// Dynamic Autonomy Protocol
	let autonomyProtocol: string;
	if (isFullAccess) {
		autonomyProtocol = `=== AUTONOMOUS FULL ACCESS MODE (HIGH VELOCITY & SELF-HEALING) ===
The user has enabled Full Access (Autonomous Mode).
1. End-to-End Autonomous Ownership: Implement all necessary components, pages, routes, logic, and tests from start to finish without pausing for trivial acknowledgments.
2. In-Loop Self-Healing: If a tool encounters an error, rejection, or unexpected output, DO NOT stop or ask the user to intervene. Analyze the failure cause, adjust your approach, and immediately execute the corrective tool call.
3. Checklist Momentum: Maintain and advance the checklist with 'manage_todo_list'. Turn after turn, continue calling action tools consecutively until every single item is verified and complete.
4. Zero Conversational Stalling: NEVER emit transitional text alone (e.g. "I will now edit file X") without executing the relevant tool in the same turn.`;
	} else {
		autonomyProtocol = `=== GOVERNED EXECUTION MODE ===
Tool execution adheres to active session access policy:
- Inspection and read-only queries proceed with high efficiency.
- File modifications, terminal commands, and browser actions follow standard user confirmation rules.`;
	}

	// Antigravity Final Report Schema in Detected Language
	let finalReportSchema: string;
	if (lang === 'id') {
		finalReportSchema = `4. PROTOKOL LAPORAN SINTESIS AKHIR ANTIGRAVITY:
   Ketika semua pekerjaan dan verifikasi selesai, ringkasan akhir dalam 'task_completed' (dan respons penutup) WAJIB menyajikan laporan terstruktur gaya Antigravity dalam Bahasa Indonesia:
   - **Ringkasan Eksekutif**: Penjelasan ringkas hasil akhir, masalah inti yang diselesaikan, dan status aplikasi saat ini.
   - **Perubahan Kunci & Arsitektur**: Daftar file yang dibuat atau diubah beserta alasan teknisnya.
   - **Bukti Verifikasi & Jaminan Kualitas**: Bukti nyata — hasil perintah pengujian/build terminal beserta kode keluar (exit code), status diagnostik via get_diagnostics, dan verifikasi interaksi browser (tanpa error konsol).
   - **Panduan Menjalankan & Menguji**: Langkah-langkah perintah shell konkret bagi pengembang untuk menjalankan atau menguji aplikasi secara lokal.`;
	} else if (lang === 'ja') {
		finalReportSchema = `4. ANTIGRAVITY 最終統合レポートプロトコル:
   すべての実装と検証が完了した際、'task_completed' の要約および最終回答において、日本語でAntigravityスタイルの構造化レポートを作成してください：
   - **エグゼクティブサマリー**: タスクの成果、解決された問題、現在のシステム状態の要約。
   - **主な変更点とアーキテクチャ**: 作成または変更されたファイルの一覧と技術的理由。
   - **検証証拠と品質保証**: 実際のターミナルテスト・ビルドコマンドの実行結果と終了コード、get_diagnostics の状態、ブラウザ検証結果。
   - **実行およびテスト手順**: ローカルでソリューションを起動・テストするための具体的なシェルコマンド。`;
	} else if (lang === 'zh') {
		finalReportSchema = `4. ANTIGRAVITY 最终综合报告协议:
   当所有实现与验证彻底完成时，'task_completed' 总结及最终回复必须输出 Antigravity 风格的中文结构化综合报告：
   - **执行摘要**：清晰陈述任务成果、核心解决的问题及当前应用状态。
   - **核心变更与架构**：创建或修改的文件清单及其技术实现依据。
   - **验证证据与质量保证**：真实的终端测试/构建命令输出及退出代码、get_diagnostics 诊断状态、浏览器交互验证结果。
   - **本地运行与测试指南**：供开发者在本地启动和测试该方案的具体命令行指令。`;
	} else {
		finalReportSchema = `4. ANTIGRAVITY FINAL SYNTHESIS REPORT PROTOCOL:
   When all work and verification are complete, the final summary in 'task_completed' (and your concluding response) MUST deliver an Antigravity-style structured synthesis report in ${langName}:
   - **Executive Summary**: Crisp statement of task outcome, core problems resolved, and current application state.
   - **Key Changes & Architecture**: Bulleted summary of files created or modified with concise technical rationale.
   - **Verification Evidence & Quality Assurance**: Concrete proof of verification — actual terminal test/build commands with exit codes, compiler diagnostics status via get_diagnostics, and browser interaction verification results.
   - **How to Run & Test**: Explicit step-by-step shell commands for the developer to launch, test, or verify the solution locally.`;
	}

	return `${personaBlock}

=== ACTIVE WORKSPACE PROJECT CONTEXT ===
${snapshot.hasWorkspace ? `
- Project Name: ${snapshot.projectName}
- Root Path: ${snapshot.rootPath}
- Tech Stack & Metadata: ${snapshot.techStack}
- Active Open File in Editor: ${snapshot.activeFile || 'None currently open'}${browserContextLine}
${snapshot.activeFileExcerpt ? `\n--- Excerpt of Active File (${snapshot.activeFile}) ---\n${snapshot.activeFileExcerpt}\n--- End Excerpt ---\n` : ''}
- Project Structure & Files:
${snapshot.fileTree || 'No files found'}
${stackSpecialization ? `\n--- Dynamic Architecture Intelligence ---${stackSpecialization}` : ''}
` : `- No folder is currently open in the workspace.${browserContextLine}`}

${autonomyProtocol}

=== STRICT TOOL DEFINITIONS & INTEGRITY (EXACTLY 31 TOOLS) ===
NEVER hallucinate or invoke non-existent tools such as 'bash', 'probe', 'sh', 'cmd', 'terminal', 'exec', or 'str_replace_editor'. To run shell commands, ALWAYS use 'run_command'. To read or inspect files, use 'read_file', 'grep_search', or 'find_files'.
1. read_file(filePath, startLine, endLine): Read file contents with line numbers.
2. write_file(filePath, content): Create new files or overwrite existing files.
3. edit_file(filePath, searchContent, replaceContent): Replace specific code snippets in files.
4. delete_file(filePath, recursive): Delete a file or directory.
5. rename_file(oldFilePath, newFilePath, overwrite): Rename or move files/directories.
6. list_directory(dirPath): List files and directories.
7. find_files(pattern): Search for files by filename or glob pattern.
8. search_code(query): Search code keywords across the codebase.
9. grep_search(pattern, subPath, isRegex, caseInsensitive): Fast regex or pattern search with line numbers.
10. get_file_outline(filePath): Extract symbols, functions, classes, and code structure of a file.
11. get_diagnostics(filePath, severity): Check active compiler, linter, or syntax errors and warnings.
12. run_command(command): Run commands in the workspace integrated terminal (build, test, install, git, dev). The terminal runs ${isWindows ? 'Windows PowerShell' : 'POSIX Bash/Zsh'}.
13. manage_todo_list(todoList): Manage and track task checklist (not-started, in-progress, completed).
14. fetch_web_page(url): Fetch web page content or API documentation.
15. open_browser_page(url, forceNew): Open or focus a URL in the Dardcor Code Integrated Browser with the Dardcor cursor and return its interactive DOM snapshot.
16. read_browser_page(pageId): Scan the active browser tab, indexing all interactive elements with Vercel-style refs (@e1, @e2, ...) and Set-of-Mark IDs [1..N], visible text, scroll state, and console errors.
17. navigate_browser(url, pageId): Navigate the active browser tab to a new URL and return the new DOM snapshot.
18. click_element(ref, elementId, selector, text, x, y, doubleClick): Move the Dardcor cursor to a target button, link, or tab using its Vercel-style ref (e.g. ref: "@e1" or elementId: "@e1" or "1"), selector, or coordinates and click it with Playwright.
19. type_in_page(text, ref, elementId, selector, clearFirst, pressEnter): Move the Dardcor cursor to an input/textarea using its Vercel-style ref (e.g. ref: "@e2" or elementId: "@e2" or "2"), type with Playwright, and optionally press Enter.
20. scroll_browser_page(direction, amount, selector, ref, elementId): Scroll the browser page (down/up/top/bottom) or scroll directly to an element using its Vercel-style ref (e.g. ref: "@e1").
21. hover_element(ref, elementId, selector, text, x, y): Move the Dardcor cursor over an element using its Vercel-style ref (e.g. ref: "@e1" or "1") to trigger hover menus or tooltips.
22. press_key(key): Press keyboard keys ("Enter", "Escape", "Tab", "ArrowDown", "Backspace", etc.) in the browser.
23. select_option(ref, elementId, selector, value, optionText, index): Select an option from a <select> dropdown in the browser using its Vercel-style ref (e.g. ref: "@e6").
24. drag_and_drop(sourceRef, sourceElementId, targetRef, targetElementId): Drag and drop elements in the browser using Vercel-style refs (e.g. sourceRef: "@e1", targetRef: "@e2").
25. wait_for_browser(selector, text, timeoutMs): Wait for an element, text, or DOM stability in the browser.
26. execute_browser_script(script): Execute custom JavaScript inside the active browser page and inspect the returned result.
27. get_browser_console_logs(pageId): Read console logs, warnings, and runtime JavaScript errors from the browser page.
28. handle_browser_dialog(accept, promptText): Accept or dismiss browser alert/confirm/prompt dialogs.
29. screenshot_browser_page(pageId): Capture a live screenshot and full DOM snapshot of the active browser page.
30. task_completed(summary, verificationSteps, filesChanged): Request completion review with an Antigravity-style final synthesis report in the user's language. Runtime checks require completed checklist items and verified evidence.
31. review_plan(title, content, actions): Present a structured implementation plan to the user in the center editor and wait for review and approval before making changes. Automatically saves to editor memory and opens directly in the center editor.

=== RUNTIME ENVIRONMENT & EXECUTION RULES ===
1. Terminal command execution:
   - The workspace terminal runs ${isWindows ? 'Windows PowerShell' : 'POSIX Bash/Zsh'}.
   ${isWindows ? `- On Windows:
     * The integrated terminal executes Windows PowerShell.
     * ZERO FALSE BLOCKERS POLICY: Windows PowerShell fully supports Node.js, npm, pnpm, yarn, Git, PHP, Composer, Python, Cargo, Docker, and developer CLIs.
     * Use valid PowerShell syntax: chain commands with semicolons (;), NEVER use "&&" or "cmd /c". NEVER use Unix bash heredocs (<< EOF). Set environment variables via \`$env:KEY="value"\` if needed.
     * Standard developer commands ("npm run build", "npm test", "php artisan test", "git status") execute directly. An exit code of 0 indicates success.` : `- On POSIX systems: use standard bash/zsh syntax.`}
2. Super-Intelligent Chromium Browser & Visual Cursor Protocol:
   - You control a real integrated Chromium browser with the Dardcor cursor powered by Vercel agent-browser architecture.
   - Always prioritize targeting interactive elements using Vercel-style element references (e.g. \`ref: "@e1"\` or \`elementId: "@e1"\`) from the snapshot.
   - For client-rendered Single Page Applications (SPAs like Shopee, Tokopedia, React/Vue dashboards), NEVER attempt to install Playwright, Puppeteer, or headless browsers in the user's workspace via terminal (\`npm install playwright\`). The integrated browser ALREADY has complete browser automation, CDP network inspection, and Playwright integration. Use \`open_browser_page\`, \`wait_for_browser\`, \`read_browser_page\`, and \`execute_browser_script\` directly.
   - Inspect post-action DOM snapshots and console diagnostics. Fix any runtime UI issues proactively.
3. Clean Workspace Directive:
   - NEVER create a ".vscode" or ".dardcor-code" folder, and NEVER create any "tasks.json" file in the user's project.
   - Keep the project directory completely clean, containing ONLY genuine application files and code.
   - When creating implementation plans (such as in /plan mode), NEVER create plan.md or planning files in the user workspace root. Store plans in editor memory (~/.dardcor/memory/plans/<session-id>/plan.md) and present the formatted plan in the chat response.
${finalReportSchema}`;
}

export const DARDCOR_SYSTEM_PROMPT = buildDardcorSystemPrompt({
	hasWorkspace: false,
	projectName: 'General',
	rootPath: '',
	techStack: 'General Software Engineering',
	fileTree: ''
});

export function extractAgentFilePath(args: any): string | undefined {
	if (!args) {
		return undefined;
	}
	if (typeof args === 'string') {
		const trimmed = args.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (typeof args !== 'object') {
		return undefined;
	}

	const candidate = args.filePath
		?? args.path
		?? args.file_path
		?? args.targetFile
		?? args.target_file
		?? args.file
		?? args.filename
		?? args.filepath;

	if (typeof candidate === 'string') {
		const trimmed = candidate.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (candidate && typeof candidate === 'object') {
		return extractAgentFilePath(candidate);
	}
	return undefined;
}

export function resolveAgentUri(filePath: string | undefined, rootUri?: URI): URI {
	const raw = typeof filePath === 'string' ? filePath.trim() : '';
	if (!raw) {
		return rootUri ?? URI.file('/');
	}
	const clean = raw.replace(/^[\\\/]+/, '');
	if (!rootUri) {
		return URI.file(raw);
	}
	if (/^[a-zA-Z]:[\\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
		return URI.file(raw);
	}
	return joinPath(rootUri, clean);
}

export interface IAgentFileReadResolution {
	target: URI;
	canonicalTarget?: URI;
	requiresApproval: boolean;
}

export async function resolveAgentFileReadTarget(fileService: IFileService | undefined, filePath: string | undefined, rootUri: URI | undefined): Promise<IAgentFileReadResolution> {
	const target = resolveAgentUri(filePath, rootUri);
	if (!fileService || !filePath?.trim() || !rootUri) {
		return { target, requiresApproval: true };
	}

	const lexicalContainment = extUriBiasedIgnorePathCase.isEqualOrParent(target, rootUri);

	try {
		if (!(await fileService.exists(target))) {
		return { target, requiresApproval: true };
		}

		const [realRoot, realTarget] = await Promise.all([
			fileService.realpath(rootUri),
			fileService.realpath(target)
		]);

		if (!realRoot || !realTarget) {
			return { target, requiresApproval: true };
		}

		const insideWorkspace = lexicalContainment && extUriBiasedIgnorePathCase.isEqualOrParent(realTarget, realRoot);
		return {
			target: realTarget,
			canonicalTarget: realTarget,
			requiresApproval: !insideWorkspace
		};
	} catch {
		return { target, requiresApproval: true };
	}
}

export async function isAgentFilePathOutsideWorkspace(fileService: IFileService | undefined, filePath: string | undefined, rootUri: URI | undefined): Promise<boolean> {
	return (await resolveAgentFileReadTarget(fileService, filePath, rootUri)).requiresApproval;
}

export interface IDynamicSkillInstruction {
	name: string;
	description?: string;
	body: string;
}

export function parseDynamicSkillMarkdown(rawContent: string, defaultName: string): IDynamicSkillInstruction {
	let name = defaultName;
	let description: string | undefined;
	let body = rawContent;

	const trimmed = rawContent.trimStart();
	if (trimmed.startsWith('---')) {
		const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
		if (match) {
			const frontmatter = match[1];
			body = match[2].trim();

			const nameMatch = /^name:\s*([^\r\n]+)/m.exec(frontmatter);
			if (nameMatch) {
				const candidateName = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
				if (candidateName) {
					name = candidateName;
				}
			}

			const descMatch = /^description:\s*([^\r\n>|]+)/m.exec(frontmatter);
			if (descMatch) {
				description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
			} else {
				const multiDescMatch = /^description:\s*[>|]\r?\n([\s\S]*?)(?=\r?\n[a-zA-Z0-9_-]+:|$)/m.exec(frontmatter);
				if (multiDescMatch) {
					description = multiDescMatch[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ');
				}
			}
		}
	}

	return { name, description, body };
}

export interface IDardcorThinkingCallbacks {
	onThinking: (chunk: string) => void;
	onMarkdownContent: (chunk: string) => void;
	onRetroactiveReclassify?: (leakedMarkdown: string) => void;
}

export class DardcorThinkingStreamParser {
	private _inThinking: boolean = false;
	private _inToolCall: boolean = false;
	private _holdbackBuffer: string = '';
	private _emittedMarkdownInTurn: string = '';

	public static readonly OPEN_THINK_REGEX = /^(?:<(?:think|thinking|thought|reasoning|antThinking)(?:\s+[^>]*)?>|◁think▷|<\|begin_of_thought\|>|\[THINK\])/i;
	public static readonly CLOSE_THINK_REGEX = /^(?:<\/(?:think|thinking|thought|reasoning|antThinking)\s*>|◁\/think▷|<\|end_of_thought\|>|\[\/THINK\])/i;

	public static readonly OPEN_TOOL_REGEX = /^(?:<(?:tool_call|function_call|tool)(?:\s+[^>]*)?>|<function(?:[=\s][^>]*)?>|\[(?:TOOL_CALL|FUNCTION_CALL)\]|```(?:tool_call|json:tool))/i;
	public static readonly CLOSE_TOOL_REGEX = /^(?:<\/(?:tool_call|function_call|tool|function)\s*>|\[\/(?:TOOL_CALL|FUNCTION_CALL)\]|```)/i;
	public static readonly ORPHAN_TOOL_TAG_REGEX = /^(?:<\/?(?:parameter|param|arg|tool_call|function_call|tool|function)(?:[=\s][^>]*)?>|\[\/?(?:TOOL_CALL|FUNCTION_CALL)\])/i;

	public static readonly ANY_TAG_SEARCH = /<(?:think|thinking|thought|reasoning|antThinking)(?:\s+[^>]*)?>|<\/(?:think|thinking|thought|reasoning|antThinking)\s*>|◁\/?think▷|<\|(?:begin|end)_of_thought\|>|\[\/?THINK\]|<\/?(?:tool_call|function_call|tool|function|parameter|param|arg)(?:[=\s][^>]*)?>|\[\/?(?:TOOL_CALL|FUNCTION_CALL)\]|```(?:tool_call|json:tool)/gi;

	public static readonly FULL_THINK_BLOCK_REGEX = /<(?:think|thinking|thought|reasoning|antThinking)(?:\s+[^>]*)?>[\s\S]*?(?:<\/(?:think|thinking|thought|reasoning|antThinking)\s*>|$)|◁think▷[\s\S]*?(?:◁\/think▷|$)|<\|begin_of_thought\|>[\s\S]*?(?:<\|end_of_thought\|>|$)|(?:\[THINK\]|Thinking Process:?)[\s\S]*?(?:\[\/THINK\]|$)/gi;
	public static readonly FULL_TOOL_BLOCK_REGEX = /<(?:tool_call|function_call|tool)(?:\s+[^>]*)?>[\s\S]*?(?:<\/(?:tool_call|function_call|tool)>|$)|<(?:function)(?:[=\s][^>]*)?>[\s\S]*?(?:<\/(?:function)>|$)|\[(?:TOOL_CALL|FUNCTION_CALL)\][\s\S]*?(?:\[\/(?:TOOL_CALL|FUNCTION_CALL)\]|$)|```(?:tool_call|json:tool)[\s\S]*?(?:```|$)/gi;

	public static readonly OPEN_TAG_REGEX = DardcorThinkingStreamParser.OPEN_THINK_REGEX;
	public static readonly CLOSE_TAG_REGEX = DardcorThinkingStreamParser.CLOSE_THINK_REGEX;

	private static readonly POTENTIAL_PREFIX = /(?:<[\/|]?[a-zA-Z0-9_\s=:"'-]*|◁[\/]?[a-zA-Z0-9_\s]*|\[[\/]?[a-zA-Z0-9_\s]*|```[a-zA-Z0-9_]*)$/;

	constructor(private readonly callbacks: IDardcorThinkingCallbacks) {}

	public processReasoningDelta(reasoningDelta: string): void {
		if (!reasoningDelta) return;
		const clean = reasoningDelta.replace(DardcorThinkingStreamParser.ANY_TAG_SEARCH, '');
		if (clean) {
			this.callbacks.onThinking(clean);
		}
	}

	public processContentDelta(delta: string): void {
		if (!delta) return;

		let combined = this._holdbackBuffer + delta;
		this._holdbackBuffer = '';

		const prefixMatch = combined.match(DardcorThinkingStreamParser.POTENTIAL_PREFIX);
		if (prefixMatch && prefixMatch[0].length <= 32 &&
			!DardcorThinkingStreamParser.CLOSE_THINK_REGEX.test(prefixMatch[0]) &&
			!DardcorThinkingStreamParser.OPEN_THINK_REGEX.test(prefixMatch[0]) &&
			!DardcorThinkingStreamParser.OPEN_TOOL_REGEX.test(prefixMatch[0]) &&
			!DardcorThinkingStreamParser.CLOSE_TOOL_REGEX.test(prefixMatch[0]) &&
			!DardcorThinkingStreamParser.ORPHAN_TOOL_TAG_REGEX.test(prefixMatch[0])) {
			this._holdbackBuffer = prefixMatch[0];
			combined = combined.slice(0, combined.length - prefixMatch[0].length);
		}

		if (!combined) return;

		this._consume(combined);
	}

	private _consume(text: string): void {
		let remaining = text;
		while (remaining.length > 0) {
			if (this._inThinking) {
				DardcorThinkingStreamParser.ANY_TAG_SEARCH.lastIndex = 0;
				const match = DardcorThinkingStreamParser.ANY_TAG_SEARCH.exec(remaining);
				if (!match) {
					this.callbacks.onThinking(remaining);
					break;
				}

				const matchIndex = match.index;
				const matchStr = match[0];
				const isClose = DardcorThinkingStreamParser.CLOSE_THINK_REGEX.test(matchStr);

				const thinkChunk = remaining.slice(0, matchIndex);
				if (thinkChunk) {
					this.callbacks.onThinking(thinkChunk);
				}

				if (isClose) {
					this._inThinking = false;
				}
				remaining = remaining.slice(matchIndex + matchStr.length);
			} else if (this._inToolCall) {
				DardcorThinkingStreamParser.ANY_TAG_SEARCH.lastIndex = 0;
				const match = DardcorThinkingStreamParser.ANY_TAG_SEARCH.exec(remaining);
				if (!match) {

					break;
				}

				const matchIndex = match.index;
				const matchStr = match[0];
				const isClose = DardcorThinkingStreamParser.CLOSE_TOOL_REGEX.test(matchStr);

				if (isClose) {
					this._inToolCall = false;
				}
				remaining = remaining.slice(matchIndex + matchStr.length);
			} else {

				DardcorThinkingStreamParser.ANY_TAG_SEARCH.lastIndex = 0;
				const match = DardcorThinkingStreamParser.ANY_TAG_SEARCH.exec(remaining);
				if (!match) {
					this._emittedMarkdownInTurn += remaining;
					this.callbacks.onMarkdownContent(remaining);
					break;
				}

				const matchIndex = match.index;
				const matchStr = match[0];
				const isOpenThink = DardcorThinkingStreamParser.OPEN_THINK_REGEX.test(matchStr);
				const isCloseThink = DardcorThinkingStreamParser.CLOSE_THINK_REGEX.test(matchStr);
				const isOpenTool = DardcorThinkingStreamParser.OPEN_TOOL_REGEX.test(matchStr);
				const isCloseTool = DardcorThinkingStreamParser.CLOSE_TOOL_REGEX.test(matchStr);
				const isOrphanTool = DardcorThinkingStreamParser.ORPHAN_TOOL_TAG_REGEX.test(matchStr);

				if (isOpenThink) {
					const preText = remaining.slice(0, matchIndex);
					if (preText) {
						this._emittedMarkdownInTurn += preText;
						this.callbacks.onMarkdownContent(preText);
					}
					this._inThinking = true;
					remaining = remaining.slice(matchIndex + matchStr.length);
				} else if (isCloseThink) {
					const preText = remaining.slice(0, matchIndex);
					if (preText) {
						this.callbacks.onThinking(preText);
					}
					if (this._emittedMarkdownInTurn.length > 0) {
						this.callbacks.onRetroactiveReclassify?.(this._emittedMarkdownInTurn);
						this._emittedMarkdownInTurn = '';
					}
					this._inThinking = false;
					remaining = remaining.slice(matchIndex + matchStr.length);
				} else if (isOpenTool) {
					const preText = remaining.slice(0, matchIndex);
					if (preText) {
						this._emittedMarkdownInTurn += preText;
						this.callbacks.onMarkdownContent(preText);
					}
					this._inToolCall = true;
					remaining = remaining.slice(matchIndex + matchStr.length);
				} else if (isCloseTool || isOrphanTool) {

					const preText = remaining.slice(0, matchIndex);
					if (preText) {
						this._emittedMarkdownInTurn += preText;
						this.callbacks.onMarkdownContent(preText);
					}

					remaining = remaining.slice(matchIndex + matchStr.length);
				} else {
					remaining = remaining.slice(matchIndex + matchStr.length);
				}
			}
		}
	}

	public flush(): void {
		if (this._holdbackBuffer) {
			let remaining = this._holdbackBuffer.replace(DardcorThinkingStreamParser.ANY_TAG_SEARCH, '');
			remaining = remaining.replace(/<[\/|]?[a-zA-Z0-9_\s=:"'-]*$/i, '');
			if (remaining) {
				if (this._inThinking) {
					this.callbacks.onThinking(remaining);
				} else if (!this._inToolCall) {
					this._emittedMarkdownInTurn += remaining;
					this.callbacks.onMarkdownContent(remaining);
				}
			}
			this._holdbackBuffer = '';
		}
		this._inThinking = false;
		this._inToolCall = false;
	}

	public get inThinking(): boolean {
		return this._inThinking;
	}

	public get inToolCall(): boolean {
		return this._inToolCall;
	}

	public static sanitizeText(text: string): string {
		if (!text) return '';
		let clean = text;
		clean = clean.replace(DardcorThinkingStreamParser.FULL_THINK_BLOCK_REGEX, '');
		clean = clean.replace(DardcorThinkingStreamParser.FULL_TOOL_BLOCK_REGEX, '');
		clean = clean.replace(DardcorThinkingStreamParser.ANY_TAG_SEARCH, '');
		clean = clean.replace(/<\/?(?:tool_call|function_call|tool|function|parameter|param|arg)(?:[=\s][^>]*)?>/gi, '');
		clean = clean.replace(/\[\/?(?:TOOL_CALL|FUNCTION_CALL)\]/gi, '');
		clean = clean.replace(/<[\/|]?(?:tool|func|param|think|thought|reasoning)[^>]*$/i, '');
		return clean.trim();
	}
}

export function isInternalThinkingMonologue(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return true;
	}
	return /^(?:I need to\b|Let me\b|I must\b|Actually,\s*(?:the\s*lazy|let\s*me|I|we)\b|Better:\s*write\b|Decision:\s*(?:translate|implement|use|do)\b|Go\.\b|split across turns\b|Still lots of text\b|Writing a \w+ script\b|Now I will\b|Next I should\b|First let me\b|Let's check\b|Let's run\b|Let's look\b|Saya perlu\b|Mari kita\b|Saya akan\b|Saya harus\b)/i.test(trimmed)
		|| /(?:I need to actually call a tool|I must call \w+ now|Let me write \w+ first|Let me actually invoke a tool|I need to call a tool|I must invoke \w+ now)/i.test(trimmed);
}

export function extractTodosFromPlan(content: string, title?: string): Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }> {
	const todos: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }> = [];
	const lines = content.split('\n');
	let idCounter = 1;

	for (const line of lines) {
		const trimmed = line.trim();
		const phaseHeaderMatch = trimmed.match(/^#{2,4}\s*(?:Phase|Tahap|Step|Task|Langkah)\s*(\d+)?[:.-]\s*(.+)/i);
		if (phaseHeaderMatch) {
			const label = (phaseHeaderMatch[1] ? `Phase ${phaseHeaderMatch[1]}: ` : '') + phaseHeaderMatch[2].replace(/[#*_`]/g, '').trim();
			if (label.length > 3 && !todos.some(t => t.title === label)) {
				todos.push({
					id: `plan_task_${idCounter++}`,
					title: label.slice(0, 80),
					status: 'pending'
				});
				continue;
			}
		}

		const numberedMatch = trimmed.match(/^\d+\.\s+\*\*([^*]+)\*\*/);
		if (numberedMatch) {
			const label = numberedMatch[1].trim();
			if (label.length > 3 && !todos.some(t => t.title === label)) {
				todos.push({
					id: `plan_task_${idCounter++}`,
					title: label.slice(0, 80),
					status: 'pending'
				});
				continue;
			}
		}

		const checkMatch = trimmed.match(/^-\s*\[[\s]\]\s*(.+)/);
		if (checkMatch) {
			const label = checkMatch[1].replace(/[#*_`]/g, '').trim();
			if (label.length > 3 && !todos.some(t => t.title === label)) {
				todos.push({
					id: `plan_task_${idCounter++}`,
					title: label.slice(0, 80),
					status: 'pending'
				});
			}
		}
	}

	if (todos.length === 0) {
		for (const line of lines) {
			const trimmed = line.trim();
			const sectionMatch = trimmed.match(/^###?\s+(\d+\.?[^\n]+)/);
			if (sectionMatch) {
				const label = sectionMatch[1].replace(/[#*_`]/g, '').trim();
				if (!/^(?:Objective|Goal|User Feedback|Approval|Open Questions|Sasaran|Pertanyaan)/i.test(label) && label.length > 3) {
					todos.push({
						id: `plan_task_${idCounter++}`,
						title: label.slice(0, 80),
						status: 'pending'
					});
				}
			}
		}
	}

	if (todos.length === 0) {
		todos.push(
			{ id: 'plan_task_1', title: `Setup & foundation for ${title || 'feature'}`, status: 'pending' },
			{ id: 'plan_task_2', title: `Core logic & components implementation`, status: 'pending' },
			{ id: 'plan_task_3', title: `Verification & testing`, status: 'pending' }
		);
	}

	return todos.slice(0, 10);
}

export class ChatAgentService extends Disposable implements IChatAgentService {

	public static readonly AGENT_LEADER = '@';

	declare _serviceBrand: undefined;

	private _agents = new Map<string, IChatAgentEntry>();

	private readonly _onDidChangeAgents = this._register(new Emitter<IChatAgent | undefined>());
	readonly onDidChangeAgents: Event<IChatAgent | undefined> = this._onDidChangeAgents.event;
	private readonly _onWillInvokeAgent = this._register(new Emitter<IChatAgentInvocationEvent>());
	readonly onWillInvokeAgent: Event<IChatAgentInvocationEvent> = this._onWillInvokeAgent.event;

	private readonly _agentsContextKeys = new Set<string>();
	private readonly _hasDefaultAgent: IContextKey<boolean>;
	private readonly _extensionAgentRegistered: IContextKey<boolean>;
	private readonly _defaultAgentRegistered: IContextKey<boolean>;
	private _hasToolsAgent = false;

	private _chatParticipantDetectionProviders = new Map<number, IChatParticipantDetectionProvider>();

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._hasDefaultAgent = ChatContextKeys.enabled.bindTo(this.contextKeyService);
		this._extensionAgentRegistered = ChatContextKeys.extensionParticipantRegistered.bindTo(this.contextKeyService);
		this._defaultAgentRegistered = ChatContextKeys.panelParticipantRegistered.bindTo(this.contextKeyService);
		this._register(contextKeyService.onDidChangeContext((e) => {
			if (e.affectsSome(this._agentsContextKeys)) {
				this._updateContextKeys();
			}
		}));

		const fallbackAgentData: IChatAgentData = {
			id: 'dardcor.default',
			name: 'Dardcor Code',
			fullName: 'Dardcor Code',
			description: 'Dardcor Default Agent',
			extensionId: new ExtensionIdentifier('dardcor.core'),
			extensionPublisherId: 'dardcor',
			extensionDisplayName: 'Dardcor Code',
			extensionVersion: '1.0.0',
			isDefault: true,
			isDynamic: true,
			isCore: true,
			metadata: {},
			slashCommands: [],
			locations: [
				ChatAgentLocation.Chat,
				ChatAgentLocation.Terminal,
				ChatAgentLocation.Notebook,
				ChatAgentLocation.EditorInline,
			],
			modes: [ChatModeKind.Ask, ChatModeKind.Agent, ChatModeKind.Edit],
			disambiguation: [],
		};

		this._register(this.registerDynamicAgent(fallbackAgentData, {
			invoke: async (request, progress, history, token) => {
				return this.streamDardcorRouter(request, progress, history, token);
			}
		}));
	}

	registerAgent(id: string, data: IChatAgentData): IDisposable {
		const existingAgent = this.getAgent(id);
		if (existingAgent) {
			throw new Error(`Agent already registered: ${JSON.stringify(id)}`);
		}

		const that = this;
		const commands = data.slashCommands;
		data = {
			...data,
			get slashCommands() {
				return commands.filter(c => !c.when || that.contextKeyService.contextMatchesRules(ContextKeyExpr.deserialize(c.when)));
			}
		};
		const entry = { data };
		this._agents.set(id, entry);
		this._updateAgentsContextKeys();
		this._updateContextKeys();
		this._onDidChangeAgents.fire(undefined);

		return toDisposable(() => {
			this._agents.delete(id);
			this._updateAgentsContextKeys();
			this._updateContextKeys();
			this._onDidChangeAgents.fire(undefined);
		});
	}

	private _updateAgentsContextKeys(): void {
		this._agentsContextKeys.clear();
		for (const agent of this._agents.values()) {
			if (agent.data.when) {
				const expr = ContextKeyExpr.deserialize(agent.data.when);
				for (const key of expr?.keys() || []) {
					this._agentsContextKeys.add(key);
				}
			}
		}
	}

	private _updateContextKeys(): void {
		let extensionAgentRegistered = false;
		let defaultAgentRegistered = false;
		let toolsAgentRegistered = false;
		for (const agent of this.getAgents()) {
			if (agent.isDefault) {
				if (!agent.isCore) {
					extensionAgentRegistered = true;
				}
				if (agent.id === 'chat.setup' || agent.id === 'github.dardcor.editsAgent') {
					toolsAgentRegistered = true;
				} else {
					defaultAgentRegistered = true;
				}
			}
		}
		this._defaultAgentRegistered.set(defaultAgentRegistered);
		this._extensionAgentRegistered.set(extensionAgentRegistered);
		if (toolsAgentRegistered !== this._hasToolsAgent) {
			this._hasToolsAgent = toolsAgentRegistered;
			this._onDidChangeAgents.fire(this.getDefaultAgent(ChatAgentLocation.Chat, ChatModeKind.Agent));
		}
	}

	registerAgentImplementation(id: string, agentImpl: IChatAgentImplementation): IDisposable {
		const entry = this._agents.get(id);
		if (!entry) {
			throw new Error(`Unknown agent: ${JSON.stringify(id)}`);
		}

		if (entry.impl) {
			throw new Error(`Agent already has implementation: ${JSON.stringify(id)}`);
		}

		if (entry.data.isDefault) {
			this._hasDefaultAgent.set(true);
		}

		entry.impl = agentImpl;
		this._onDidChangeAgents.fire(new MergedChatAgent(entry.data, agentImpl));

		return toDisposable(() => {
			entry.impl = undefined;
			this._onDidChangeAgents.fire(undefined);

			if (entry.data.isDefault) {
				this._hasDefaultAgent.set(Iterable.some(this._agents.values(), agent => agent.data.isDefault && !!agent.impl));
			}
		});
	}

	registerDynamicAgent(data: IChatAgentData, agentImpl: IChatAgentImplementation): IDisposable {
		data.isDynamic = true;
		const agent = { data, impl: agentImpl };
		this._agents.set(data.id, agent);
		if (data.isDefault) {
			this._hasDefaultAgent.set(true);
		}
		this._updateAgentsContextKeys();
		this._updateContextKeys();
		this._onDidChangeAgents.fire(new MergedChatAgent(data, agentImpl));

		return toDisposable(() => {
			this._agents.delete(data.id);
			this._updateAgentsContextKeys();
			this._updateContextKeys();
			this._onDidChangeAgents.fire(undefined);
		});
	}

	private _agentCompletionProviders = new Map<string, (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>>();

	registerAgentCompletionProvider(id: string, provider: (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>) {
		this._agentCompletionProviders.set(id, provider);
		return {
			dispose: () => { this._agentCompletionProviders.delete(id); }
		};
	}

	async getAgentCompletionItems(id: string, query: string, token: CancellationToken) {
		return await this._agentCompletionProviders.get(id)?.(query, token) ?? [];
	}

	updateAgent(id: string, updateMetadata: IChatAgentMetadata): void {
		const agent = this._agents.get(id);
		if (!agent?.impl) {
			throw new Error(`No activated agent with id ${JSON.stringify(id)} registered`);
		}
		agent.data.metadata = { ...agent.data.metadata, ...updateMetadata };
		this._onDidChangeAgents.fire(new MergedChatAgent(agent.data, agent.impl));
	}

	getDefaultAgent(location: ChatAgentLocation, mode: ChatModeKind = ChatModeKind.Ask): IChatAgent | undefined {
		const matching = this._preferExtensionAgent(this.getActivatedAgents().filter(a => {
			if (mode && !a.modes.includes(mode)) {
				return false;
			}

			return !!a.isDefault && a.locations.includes(location);
		}));
		if (matching) {
			return matching;
		}
		const fallback = this._preferExtensionAgent(this.getActivatedAgents().filter(a => !!a.isDefault)) ?? this.getActivatedAgents()[0];
		if (fallback) {
			return fallback;
		}
		const defaultEntry = this._agents.get('dardcor.default');
		if (defaultEntry) {
			return new MergedChatAgent(defaultEntry.data, defaultEntry.impl ?? {
				invoke: (req, prog, hist, tok) => this.streamDardcorRouter(req, prog, hist, tok)
			});
		}
		return undefined;
	}

	public get hasToolsAgent(): boolean {
		return !!this.configurationService.getValue(ChatConfiguration.AgentEnabled);
	}

	getContributedDefaultAgent(location: ChatAgentLocation): IChatAgentData | undefined {
		return this._preferExtensionAgent(this.getAgents().filter(a => !!a.isDefault && a.locations.includes(location)));
	}

	private _preferExtensionAgent<T extends IChatAgentData>(agents: T[]): T | undefined {
		return findLast(agents, agent => !agent.isCore) ?? agents.at(-1);
	}

	getAgent(id: string, includeDisabled = false): IChatAgentData | undefined {
		if (!this._agentIsEnabled(id) && !includeDisabled) {
			return;
		}

		return this._agents.get(id)?.data;
	}

	private _agentIsEnabled(idOrAgent: string | IChatAgentEntry): boolean {
		const entry = typeof idOrAgent === 'string' ? this._agents.get(idOrAgent) : idOrAgent;
		return !entry?.data.when || this.contextKeyService.contextMatchesRules(ContextKeyExpr.deserialize(entry.data.when));
	}

	getAgentByFullyQualifiedId(id: string): IChatAgentData | undefined {
		const agent = Iterable.find(this._agents.values(), a => a.data && getFullyQualifiedId(a.data) === id)?.data;
		if (agent && !this._agentIsEnabled(agent.id)) {
			return;
		}

		return agent;
	}

	getAgents(): IChatAgentData[] {
		return Array.from(this._agents.values())
			.map(entry => entry.data)
			.filter(a => a && this._agentIsEnabled(a.id));
	}

	getActivatedAgents(): IChatAgent[] {
		return Array.from(this._agents.values())
			.filter((agent): agent is { data: IChatAgentData; impl: IChatAgentImplementation } => !!agent.data && !!agent.impl && this._agentIsEnabled(agent.data.id))
			.map(agent => new MergedChatAgent(agent.data, agent.impl));
	}

	getAgentsByName(name: string): IChatAgentData[] {
		return this._preferExtensionAgents(this.getAgents().filter(a => a.name === name));
	}

	private _preferExtensionAgents<T extends IChatAgentData>(agents: T[]): T[] {
		const extensionAgents = agents.filter(a => !a.isCore);
		return extensionAgents.length > 0 ? extensionAgents : agents;
	}

	agentHasDupeName(id: string): boolean {
		const agent = this.getAgent(id);
		if (!agent) {
			return false;
		}

		return this.getAgentsByName(agent.name)
			.filter(a => a.extensionId.value !== agent.extensionId.value).length > 0;
	}

	async invokeAgent(id: string, request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		markChat(request.sessionResource, ChatPerfMark.AgentWillInvoke);
		let data = this._agents.get(id);
		let impl = data?.impl;
		let effectiveAgentId = id;

		if (!impl) {
			for (let i = 0; i < 30 && !impl; i++) {
				await new Promise(r => setTimeout(r, 100));
				data = this._agents.get(id);
				impl = data?.impl;
				if (!impl) {
					const extensionAgentsWithImpl = Array.from(this._agents.values()).filter(a => !a.data.isCore && !!a.impl);
					const preferredAgent = extensionAgentsWithImpl.find(a => a.data.id === 'github.dardcor.editsAgent')
						?? extensionAgentsWithImpl.find(a => a.data.id === 'github.dardcor.default')
						?? extensionAgentsWithImpl.find(a => a.data.id === 'github.dardcor.editingSession')
						?? extensionAgentsWithImpl[0];
					if (preferredAgent?.impl) {
						impl = preferredAgent.impl;
						effectiveAgentId = preferredAgent.data.id;
						break;
					}
				}
			}
		}

		if (!id || typeof id !== 'string' || id === 'dardcor.default' || id === 'chat' || id.startsWith('agent-host-') || id === 'workspace-agent') {
			return this.streamDardcorRouter(request, progress, history, token);
		}

		if (impl) {
			this._onWillInvokeAgent.fire({ agentId: effectiveAgentId, request });
			try {
				let partsEmitted = 0;
				const trackingProgress = (parts: IChatProgress[]) => {
					if (parts && parts.length > 0) {
						partsEmitted += parts.length;
						progress(parts);
					}
				};
				const result = await impl.invoke(request, trackingProgress, history, token);
				if (partsEmitted > 0 && !result?.errorDetails) {
					markChat(request.sessionResource, ChatPerfMark.AgentDidInvoke);
					return result;
				}
				console.warn(`[ChatAgentService] Agent ${effectiveAgentId} emitted 0 parts or reported error, falling back to Dardcor Router. partsEmitted=${partsEmitted}`);
			} catch (err: any) {
				console.warn(`[ChatAgentService] Agent ${effectiveAgentId} invoke failed, falling back to Dardcor Router:`, err);
			}
		}

		return this.streamDardcorRouter(request, progress, history, token);
	}

	async getWorkspaceSnapshot(): Promise<IWorkspaceSnapshot> {
		let workspaceContextService: IWorkspaceContextService | undefined;
		let fileService: IFileService | undefined;
		let editorService: IEditorService | undefined;
		let browserService: IBrowserViewWorkbenchService | undefined;

		try {
			this.instantiationService.invokeFunction(accessor => {
				try { workspaceContextService = accessor.get(IWorkspaceContextService); } catch { }
				try { fileService = accessor.get(IFileService); } catch { }
				try { editorService = accessor.get(IEditorService); } catch { }
				try { browserService = accessor.get(IBrowserViewWorkbenchService); } catch { }
			});
		} catch { }

		const openBrowserPages: string[] = [];
		if (browserService) {
			try {
				for (const view of browserService.getKnownBrowserViews().values()) {
					const url = view.url || 'about:blank';
					const title = view.title || view.getName() || 'Browser Tab';
					openBrowserPages.push(`"${title}" (${url}) [pageId: ${view.id}]`);
				}
			} catch { }
		}

		if (!workspaceContextService) {
			return { hasWorkspace: false, projectName: '', rootPath: '', techStack: 'Unknown', fileTree: '', openBrowserPages };
		}
		const folders = workspaceContextService.getWorkspace().folders;
		if (!folders || folders.length === 0) {
			return { hasWorkspace: false, projectName: '', rootPath: '', techStack: 'No open folder', fileTree: 'Workspace is empty', openBrowserPages };
		}
		const primaryFolder = folders[0];
		const rootUri = primaryFolder.uri;
		const projectName = primaryFolder.name || basename(rootUri);
		const rootPath = rootUri.fsPath || rootUri.path;

		let techStack = 'Standard';
		if (fileService) {
			try {
				const pkgUri = joinPath(rootUri, 'package.json');
				const stat = await fileService.stat(pkgUri);
				if (stat) {
					const pkgFile = await fileService.readFile(pkgUri);
					const pkg = JSON.parse(new TextDecoder().decode(pkgFile.value.buffer));
					const deps = Object.keys(pkg.dependencies || {});
					const devDeps = Object.keys(pkg.devDependencies || {});
					const all = [...deps, ...devDeps];
					const frameworks: string[] = [];
					if (all.includes('react')) frameworks.push('React');
					if (all.includes('next')) frameworks.push('Next.js');
					if (all.includes('vite')) frameworks.push('Vite');
					if (all.includes('vue')) frameworks.push('Vue');
					if (all.includes('svelte')) frameworks.push('Svelte');
					if (all.includes('tailwindcss')) frameworks.push('Tailwind CSS');
					if (all.some(d => d.includes('typescript')) || devDeps.some(d => d.includes('typescript'))) frameworks.push('TypeScript');
					if (all.includes('express')) frameworks.push('Express');
					if (all.includes('lucide-react')) frameworks.push('Lucide Icons');
					const scripts = Object.keys(pkg.scripts || {});
					techStack = `${pkg.name ? `Package: ${pkg.name} | ` : ''}Frameworks: ${frameworks.join(', ') || 'Node.js'} | Scripts: ${scripts.join(', ') || 'none'}`;
				}
			} catch { }

			try {
				if (await fileService.exists(joinPath(rootUri, 'Cargo.toml'))) techStack = 'Rust (Cargo)';
				else if (await fileService.exists(joinPath(rootUri, 'go.mod'))) techStack = 'Go (Go Modules)';
				else if (await fileService.exists(joinPath(rootUri, 'requirements.txt')) || await fileService.exists(joinPath(rootUri, 'pyproject.toml'))) techStack = 'Python';
				else if (await fileService.exists(joinPath(rootUri, 'pubspec.yaml'))) techStack = 'Dart / Flutter';
			} catch { }
		}

		const treeLines: string[] = [];
		const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.out', '.next', '.vscode', '.dardcor-code', '.idea', 'coverage', '.cache']);
		if (fileService) {
			const scan = async (uri: URI, prefix: string, depth: number) => {
				if (depth > 2 || treeLines.length > 70) return;
				try {
					const res = await fileService!.resolve(uri);
					if (!res.children) return;
					const sorted = res.children.slice().sort((a, b) => {
						if (a.isDirectory && !b.isDirectory) return -1;
						if (!a.isDirectory && b.isDirectory) return 1;
						return a.name.localeCompare(b.name);
					});
					for (const child of sorted) {
						if (ignoreDirs.has(child.name)) {
							if (child.isDirectory) treeLines.push(`${prefix}${child.name}/`);
							continue;
						}
						if (child.isDirectory) {
							treeLines.push(`${prefix}${child.name}/`);
							await scan(child.resource, prefix + '  ', depth + 1);
						} else {
							treeLines.push(`${prefix}${child.name}`);
						}
						if (treeLines.length > 70) break;
					}
				} catch { }
			};
			await scan(rootUri, '', 0);
		}

		let activeFile: string | undefined;
		let activeFileExcerpt: string | undefined;
		if (editorService) {
			try {
				const active = editorService.activeEditor;
				if (active) {
					const resource = EditorResourceAccessor.getCanonicalUri(active);
					if (resource) {
						activeFile = resource.fsPath || resource.path;
						if (rootUri && typeof activeFile === 'string' && activeFile.startsWith(rootUri.fsPath)) {
							activeFile = activeFile.slice(rootUri.fsPath.length).replace(/^[\\\/]+/, '');
						}
						if (fileService) {
							const fileData = await fileService.readFile(resource);
							const text = new TextDecoder().decode(fileData.value.buffer);
							activeFileExcerpt = text.split('\n').slice(0, 35).join('\n');
						}
					}
				}
			} catch { }
		}

		return {
			hasWorkspace: true,
			projectName,
			rootPath,
			rootUri,
			techStack,
			fileTree: treeLines.join('\n') || 'Project root',
			activeFile,
			activeFileExcerpt,
			openBrowserPages
		};
	}

	private _getToolDisplayInfo(toolName: string, args: any): { invocationMessage: string; pastTenseMessage: string; formattedInput: string } {
		switch (toolName) {
			case 'read_file': {
				const target = extractAgentFilePath(args) || 'file';
				const range = args?.startLine ? `:${args.startLine}${args?.endLine ? `-${args.endLine}` : ''}` : '';
				return {
					invocationMessage: `Reading \`${target}${range}\``,
					pastTenseMessage: `Read \`${target}${range}\``,
					formattedInput: `File: ${target}${range}`
				};
			}
			case 'write_file': {
				const target = extractAgentFilePath(args) || 'file';
				return {
					invocationMessage: `Writing \`${target}\``,
					pastTenseMessage: `Wrote \`${target}\``,
					formattedInput: `File: ${target}\n\nContent:\n${args?.content ?? ''}`
				};
			}
			case 'edit_file': {
				const target = extractAgentFilePath(args) || 'file';
				return {
					invocationMessage: `Editing \`${target}\``,
					pastTenseMessage: `Edited \`${target}\``,
					formattedInput: `File: ${target}\n\n<<<<<<< Search\n${args?.searchContent ?? ''}\n=======\n${args?.replaceContent ?? ''}\n>>>>>>> Replace`
				};
			}
			case 'list_directory': {
				const target = extractAgentFilePath(args) || (typeof args?.dirPath === 'string' ? args.dirPath.trim() : (typeof args?.path === 'string' ? args.path.trim() : '.'));
				return {
					invocationMessage: `Listing directory \`${target}\``,
					pastTenseMessage: `Listed directory \`${target}\``,
					formattedInput: `Directory: ${target}`
				};
			}
			case 'find_files': {
				const target = args?.pattern || '*';
				return {
					invocationMessage: `Finding files matching \`${target}\``,
					pastTenseMessage: `Found files matching \`${target}\``,
					formattedInput: `Pattern: ${target}`
				};
			}
			case 'search_code': {
				const target = args?.query || '';
				return {
					invocationMessage: `Searching code for \`${target}\``,
					pastTenseMessage: `Searched code for \`${target}\``,
					formattedInput: `Query: ${target}`
				};
			}
			case 'run_command':
			case 'run_in_terminal': {
				const target = args?.command || args?.commandLine || '';
				return {
					invocationMessage: `Running \`${target}\``,
					pastTenseMessage: `Ran \`${target}\``,
					formattedInput: `Command: ${target}`
				};
			}
			case 'send_to_terminal': {
				const target = args?.text || args?.command || args?.commandLine || '';
				return {
					invocationMessage: `Sending \`${target}\` to terminal`,
					pastTenseMessage: `Sent \`${target}\` to terminal`,
					formattedInput: `Text: ${target}`
				};
			}
			case 'get_terminal_output': {
				return {
					invocationMessage: 'Retrieving terminal output',
					pastTenseMessage: 'Retrieved terminal output',
					formattedInput: 'Reading output buffer from active terminal'
				};
			}
			case 'kill_terminal': {
				return {
					invocationMessage: 'Terminating terminal',
					pastTenseMessage: 'Terminated terminal',
					formattedInput: 'Killing active terminal instance'
				};
			}
			case 'manage_todo_list':
			case 'todo':
			case 'todo_list':
			case 'update_todo_list':
			case 'dardcor_internal_todo': {
				const normalized = normalizeTodoListArgs(args);
				const count = normalized.items.length;
				if (normalized.operation === 'read' || count === 0) {
					return {
						invocationMessage: 'Reading task checklist',
						pastTenseMessage: 'Read task checklist',
						formattedInput: typeof args === 'string' ? args : JSON.stringify(args ?? {}, null, 2)
					};
				}
				const activeItem = normalized.items.find(t => t.status === 'in-progress');
				const activeSuffix = activeItem ? ` (Active: #${activeItem.id} "${activeItem.title}")` : '';
				return {
					invocationMessage: `Updating task checklist (${count} item${count === 1 ? '' : 's'})${activeSuffix}`,
					pastTenseMessage: `Updated task checklist (${count} item${count === 1 ? '' : 's'})`,
					formattedInput: JSON.stringify(normalized.items, null, 2)
				};
			}
			case 'fetch_web_page': {
				const target = args?.url || (Array.isArray(args?.urls) ? args.urls[0] : 'URL');
				return {
					invocationMessage: `Fetching \`${target}\``,
					pastTenseMessage: `Fetched \`${target}\``,
					formattedInput: `URL: ${target}`
				};
			}
			case 'delete_file': {
				const target = extractAgentFilePath(args) || 'file';
				return {
					invocationMessage: `Deleting \`${target}\``,
					pastTenseMessage: `Deleted \`${target}\``,
					formattedInput: `File: ${target}\nRecursive: ${args?.recursive !== false}`
				};
			}
			case 'rename_file': {
				const oldPath = extractAgentFilePath(args?.oldFilePath ?? args?.oldPath) || 'oldFile';
				const newPath = extractAgentFilePath(args?.newFilePath ?? args?.newPath) || 'newFile';
				return {
					invocationMessage: `Renaming \`${oldPath}\` to \`${newPath}\``,
					pastTenseMessage: `Renamed \`${oldPath}\` to \`${newPath}\``,
					formattedInput: `From: ${oldPath}\nTo: ${newPath}\nOverwrite: ${!!args?.overwrite}`
				};
			}
			case 'get_diagnostics': {
				const target = extractAgentFilePath(args) || 'entire workspace';
				const sev = args?.severity || 'all';
				return {
					invocationMessage: `Inspecting diagnostics for \`${target}\``,
					pastTenseMessage: `Inspected diagnostics for \`${target}\``,
					formattedInput: `Target: ${target}\nSeverity filter: ${sev}`
				};
			}
			case 'get_file_outline': {
				const target = extractAgentFilePath(args) || 'file';
				return {
					invocationMessage: `Extracting outline from \`${target}\``,
					pastTenseMessage: `Extracted outline from \`${target}\``,
					formattedInput: `File: ${target}`
				};
			}
			case 'grep_search': {
				const pat = args?.pattern || '';
				const sub = args?.subPath ? ` in \`${args.subPath}\`` : '';
				return {
					invocationMessage: `Grep searching \`${pat}\`${sub}`,
					pastTenseMessage: `Grep searched \`${pat}\`${sub}`,
					formattedInput: `Pattern: ${pat}\nSubpath: ${args?.subPath || '.'}\nRegex: ${!!args?.isRegex}\nCaseInsensitive: ${args?.caseInsensitive !== false}`
				};
			}
			case 'terminal_selection': {
				return {
					invocationMessage: 'Reading terminal selection',
					pastTenseMessage: 'Read terminal selection',
					formattedInput: 'Inspecting text selection in active terminal'
				};
			}
			case 'terminal_last_command': {
				return {
					invocationMessage: 'Reading last terminal command',
					pastTenseMessage: 'Read last terminal command',
					formattedInput: 'Inspecting last executed command in active terminal'
				};
			}
			case 'create_and_run_task': {
				const lbl = args?.label || 'task';
				return {
					invocationMessage: `Creating and running task \`${lbl}\``,
					pastTenseMessage: `Created and ran task \`${lbl}\``,
					formattedInput: `Task: ${lbl}\nCommand: ${args?.command || ''}`
				};
			}
			case 'get_task_output': {
				const lbl = args?.taskLabel || 'task';
				return {
					invocationMessage: `Reading output of task \`${lbl}\``,
					pastTenseMessage: `Read output of task \`${lbl}\``,
					formattedInput: `Task: ${lbl}`
				};
			}
			case 'run_task': {
				const lbl = args?.taskLabel || 'task';
				return {
					invocationMessage: `Running task \`${lbl}\``,
					pastTenseMessage: `Ran task \`${lbl}\``,
					formattedInput: `Task: ${lbl}`
				};
			}
			case 'ask_questions': {
				const count = Array.isArray(args?.questions) ? args.questions.length : 1;
				return {
					invocationMessage: `Asking user ${count} question${count > 1 ? 's' : ''}`,
					pastTenseMessage: `Asked user ${count} question${count > 1 ? 's' : ''}`,
					formattedInput: JSON.stringify(args?.questions || [], null, 2)
				};
			}
			case 'review_plan': {
				const title = args?.title || 'Implementation Plan';
				return {
					invocationMessage: `Presenting plan for review: ${title}`,
					pastTenseMessage: `Presented plan for review: ${title}`,
					formattedInput: args?.content || title
				};
			}
			case 'run_subagent': {
				const desc = args?.description || 'subagent task';
				return {
					invocationMessage: `Running subagent: ${desc}`,
					pastTenseMessage: `Completed subagent: ${desc}`,
					formattedInput: `Prompt: ${args?.prompt || ''}\nDescription: ${desc}`
				};
			}
			case 'confirm_terminal_command': {
				const cmd = args?.command || '';
				return {
					invocationMessage: `Requesting confirmation for \`${cmd}\``,
					pastTenseMessage: `Requested confirmation for \`${cmd}\``,
					formattedInput: `Command: ${cmd}\nExplanation: ${args?.explanation || ''}`
				};
			}
			case 'set_artifacts': {
				const count = Array.isArray(args?.artifacts) ? args.artifacts.length : 0;
				return {
					invocationMessage: `Updating session artifacts (${count} items)`,
					pastTenseMessage: `Updated session artifacts (${count} items)`,
					formattedInput: JSON.stringify(args?.artifacts || [], null, 2)
				};
			}
			case 'set_artifact_rules': {
				return {
					invocationMessage: 'Configuring artifact rules',
					pastTenseMessage: 'Configured artifact rules',
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'open_browser_page': {
				const target = args?.url || 'URL';
				return {
					invocationMessage: `Opening Integrated Browser at \`${target}\``,
					pastTenseMessage: `Opened Integrated Browser at \`${target}\``,
					formattedInput: `URL: ${target}`
				};
			}
			case 'read_browser_page':
			case 'read_page': {
				return {
					invocationMessage: 'Scanning browser page DOM & interactive elements',
					pastTenseMessage: 'Scanned browser page DOM & interactive elements',
					formattedInput: `Page: ${args?.pageId || 'active'}`
				};
			}
			case 'screenshot_browser_page':
			case 'screenshot_page': {
				return {
					invocationMessage: 'Capturing browser screenshot & DOM snapshot',
					pastTenseMessage: 'Captured browser screenshot & DOM snapshot',
					formattedInput: `Page: ${args?.pageId || 'active'}`
				};
			}
			case 'navigate_browser':
			case 'navigate_page': {
				const target = args?.url || 'URL';
				return {
					invocationMessage: `Navigating browser to \`${target}\``,
					pastTenseMessage: `Navigated browser to \`${target}\``,
					formattedInput: `URL: ${target}`
				};
			}
			case 'click_element':
			case 'click_browser': {
				const target = args?.ref || args?.text || args?.selector || (args?.elementId ? `[${args.elementId}]` : '') || (args?.x !== undefined ? `(${args.x}, ${args.y})` : 'element');
				return {
					invocationMessage: `Moving Dardcor cursor & clicking \`${target}\``,
					pastTenseMessage: `Clicked \`${target}\` on browser page`,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'type_in_page':
			case 'type_browser': {
				const target = args?.ref || args?.selector || (args?.elementId ? `[${args.elementId}]` : 'input');
				return {
					invocationMessage: `Typing \`"${args?.text || ''}"\` into \`${target}\``,
					pastTenseMessage: `Typed \`"${args?.text || ''}"\` into \`${target}\``,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'scroll_browser_page':
			case 'scroll_page': {
				const desc = args?.selector || args?.ref || args?.elementId
					? `to \`${args.selector || args.ref || `[${args.elementId}]`}\``
					: `${args?.direction || 'down'} (${args?.amount || 550}px)`;
				return {
					invocationMessage: `Scrolling browser page ${desc}`,
					pastTenseMessage: `Scrolled browser page ${desc}`,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'hover_element':
			case 'hover_browser': {
				const target = args?.text || args?.selector || (args?.elementId ? `[${args.elementId}]` : 'element');
				return {
					invocationMessage: `Moving Dardcor cursor to hover \`${target}\``,
					pastTenseMessage: `Hovered \`${target}\` on browser page`,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'press_key': {
				const key = args?.key || 'Enter';
				return {
					invocationMessage: `Pressing key \`${key}\` in browser`,
					pastTenseMessage: `Pressed key \`${key}\` in browser`,
					formattedInput: `Key: ${key}`
				};
			}
			case 'select_option': {
				const opt = args?.optionText || args?.value || args?.index || 'option';
				return {
					invocationMessage: `Selecting dropdown option \`${opt}\``,
					pastTenseMessage: `Selected dropdown option \`${opt}\``,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'drag_and_drop': {
				return {
					invocationMessage: 'Dragging & dropping element with Dardcor cursor',
					pastTenseMessage: 'Dragged & dropped element on browser page',
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'wait_for_browser': {
				const cond = args?.selector || args?.text || 'DOM stability';
				return {
					invocationMessage: `Waiting for browser condition (\`${cond}\`)`,
					pastTenseMessage: `Waited for browser condition (\`${cond}\`)`,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'execute_browser_script': {
				return {
					invocationMessage: 'Executing JavaScript in browser page',
					pastTenseMessage: 'Executed JavaScript in browser page',
					formattedInput: args?.script || ''
				};
			}
			case 'get_browser_console_logs': {
				return {
					invocationMessage: 'Reading browser console & runtime errors',
					pastTenseMessage: 'Read browser console & runtime errors',
					formattedInput: `Page: ${args?.pageId || 'active'}`
				};
			}
			case 'handle_browser_dialog': {
				return {
					invocationMessage: `Handling browser dialog (${args?.accept !== false ? 'Accept' : 'Dismiss'})`,
					pastTenseMessage: `Handled browser dialog (${args?.accept !== false ? 'Accept' : 'Dismiss'})`,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'task_completed':
			case 'complete_task': {
				return {
					invocationMessage: 'Verifying task completion',
					pastTenseMessage: 'Task completion verified',
					formattedInput: typeof args?.summary === 'string' ? 'Summary verified' : JSON.stringify(args ?? {}, null, 2)
				};
			}
			default: {
				let formattedInput = typeof args === 'string' ? args : JSON.stringify(args ?? {}, null, 2);
				if (typeof args === 'string') {
					try {
						formattedInput = JSON.stringify(JSON.parse(args), null, 2);
					} catch {}
				}
				return {
					invocationMessage: `Executing ${toolName}`,
					pastTenseMessage: `Executed ${toolName}`,
					formattedInput
				};
			}
		}
	}

	private async _invokeBuiltinAgentTool(
		toolId: string,
		parameters: Record<string, any>,
		chatSessionResource: URI | undefined,
		rootUri: URI | undefined,
		requestId: string | undefined,
		token: CancellationToken,
		approvedByUser = false,
	): Promise<{ output: string; nativeToolInvocation?: boolean }> {
		if (!chatSessionResource) {
			return { output: `Built-in tool ${toolId} could not run because the chat session is unavailable.` };
		}
		let invocationStarted = false;
		try {
			let output = '';
			await this.instantiationService.invokeFunction(async accessor => {
				const toolsService = accessor.get(ILanguageModelToolsService);
				const tool = toolsService.getTool(toolId);
				if (!tool) {
					throw new Error(`Built-in tool ${toolId} is not registered in this window.`);
				}
				invocationStarted = true;
				const result = await toolsService.invokeTool({
					callId: `dardcor_router_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					toolId: tool.id,
					parameters,
					context: { sessionResource: chatSessionResource, workingDirectory: rootUri },
					chatRequestId: requestId,
					preApproved: approvedByUser ? { type: ToolConfirmKind.UserAction } : undefined,
				}, async () => 0, token);
				output = toolContentToA11yString(result.content);
				const metadata = result.toolMetadata as { exitCode?: unknown; timedOut?: unknown } | undefined;
				if (typeof metadata?.exitCode === 'number') {
					output += `${output ? '\n' : ''}[Command result: exit code ${metadata.exitCode}]`;
				}
				if (metadata?.timedOut === true) {
					output += `${output ? '\n' : ''}[Command result: timed out; the process may still be running]`;
				}
				if ((toolId === TerminalToolId.RunTask || toolId === TerminalToolId.CreateAndRunTask)
					&& typeof metadata?.exitCode !== 'number'
					&& metadata?.timedOut !== true) {
					output += `${output ? '\n' : ''}[Task result: final status unknown; poll task output before treating this as verification]`;
				}
				const message = result.toolResultMessage;
				const messageText = typeof message === 'string' ? message : (message as any)?.value;
				if (typeof messageText === 'string' && messageText.trim() && !output.includes(messageText.trim())) {
					output = `${output}${output ? '\n' : ''}${messageText.trim()}`;
				}
				if (result.toolResultError) {
					output = `${output}${output ? '\n' : ''}Built-in tool reported an error: ${result.toolResultError}`;
				}
			});
			return { output: output || `Built-in tool ${toolId} returned no output; its result is not treated as verified.`, nativeToolInvocation: true };
		} catch (error) {
			return { output: `Built-in tool ${toolId} failed: ${error instanceof Error ? error.message : String(error)}`, nativeToolInvocation: invocationStarted };
		}
	}

	private async _executeAgentTool(toolName: string, args: any, rootUri?: URI, chatSessionResource?: URI, token: CancellationToken = CancellationToken.None, requestId?: string, approvedByUser = false, fileReadResolution?: IAgentFileReadResolution): Promise<{ output: string; executionStatus?: AgentToolExecutionStatus; browserImage?: { mimeType: 'image/png'; base64: string }; nativeToolInvocation?: boolean; externalEdit?: { uri: URI; editKind: 'create' | 'edit' | 'delete'; initialContent?: string; diff: { added: number; removed: number } } }> {
		let fileService: IFileService | undefined;
		try {
			this.instantiationService.invokeFunction(accessor => {
				try { fileService = accessor.get(IFileService); } catch { }
			});
		} catch { }

		const resolveUri = (filePath: string | undefined): URI => resolveAgentUri(filePath, rootUri);
		const workspaceFolder = rootUri?.fsPath;
		if (toolName === 'run_command' || toolName === 'run_in_terminal' || toolName === 'bash' || toolName === 'execute_command' || toolName === 'cmd' || toolName === 'sh' || toolName === 'powershell' || toolName === 'terminal') {
			const command = String(args?.command ?? args?.commandLine ?? '').trim();
			if (!command) {
				return { output: 'Terminal command was not run: a non-empty command is required.' };
			}
			return this._invokeBuiltinAgentTool(TerminalToolId.RunInTerminal, {
				command,
				explanation: String(args?.explanation ?? `Run the requested command: ${command}`),
				goal: String(args?.goal ?? 'Complete the requested workspace action'),
				mode: args?.mode === 'async' || args?.isBackground ? 'async' : 'sync',
				isBackground: !!args?.isBackground,
			}, chatSessionResource, rootUri, requestId, token, approvedByUser);
		}
		if (toolName === 'run_task' || toolName === 'get_task_output') {
			if (!workspaceFolder) {
				return { output: `Task tool ${toolName} could not run: open a workspace folder first.` };
			}
			const id = String(args?.taskLabel ?? args?.label ?? args?.name ?? args?.id ?? '').trim();
			if (!id) {
				return { output: `Task tool ${toolName} could not run: provide a task label or ID.` };
			}
			return this._invokeBuiltinAgentTool(toolName === 'run_task' ? TerminalToolId.RunTask : TerminalToolId.GetTaskOutput, {
				workspaceFolder,
				id,
			}, chatSessionResource, rootUri, requestId, token, approvedByUser);
		}
		if (toolName === 'send_to_terminal') {
			const id = String(args?.id ?? args?.terminalId ?? '').trim();
			if (id) {
				return this._invokeBuiltinAgentTool(TerminalToolId.SendToTerminal, {
					id,
					command: String(args?.command ?? args?.commandLine ?? args?.text ?? ''),
					waitForOutput: args?.waitForOutput === true,
				}, chatSessionResource, rootUri, requestId, token, approvedByUser);
			}
		}
		if (toolName === 'kill_terminal') {
			const id = String(args?.id ?? args?.terminalId ?? '').trim();
			if (id) {
				return this._invokeBuiltinAgentTool(TerminalToolId.KillTerminal, { id }, chatSessionResource, rootUri, requestId, token, approvedByUser);
			}
		}
		if (toolName === 'get_terminal_output') {
			const id = String(args?.id ?? args?.terminalId ?? '').trim();
			if (id) {
				return this._invokeBuiltinAgentTool(TerminalToolId.GetTerminalOutput, { id }, chatSessionResource, rootUri, requestId, token);
			}
		}

		switch (toolName) {
			case 'read':
			case 'view_file':
			case 'read_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const targetPath = extractAgentFilePath(args);
				if (!targetPath) return { output: 'Error: Missing filePath parameter.' };
				const target = fileReadResolution?.target ?? resolveUri(targetPath);
				if (isBuiltinSkillUri(target) || targetPath.includes('dardcor-builtin') || targetPath.endsWith('skills/plan/SKILL.md') || targetPath.endsWith('plan/SKILL.md')) {
					const builtinText = getBuiltinSkillContent(target) ?? getBuiltinSkillContent(targetPath);
					if (builtinText) {
						const lines = builtinText.split('\n');
						const start = Math.max(1, typeof args?.startLine === 'number' ? args.startLine : 1);
						const end = Math.min(lines.length, typeof args?.endLine === 'number' ? args.endLine : lines.length);
						const numbered = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
						return { output: numbered || '(File is empty)' };
					}
				}
				try {
					if (fileReadResolution?.canonicalTarget) {
						const currentTarget = await fileService.realpath(target);
						if (!currentTarget || !extUriBiasedIgnorePathCase.isEqual(currentTarget, fileReadResolution.canonicalTarget)) {
							return { output: `File read stopped because the resolved file changed after its access check: ${targetPath}. Request approval again before retrying.` };
						}
					}
					const data = await fileService.readFile(target);
					if (fileReadResolution?.canonicalTarget) {
						const currentTarget = await fileService.realpath(target);
						if (!currentTarget || !extUriBiasedIgnorePathCase.isEqual(currentTarget, fileReadResolution.canonicalTarget)) {
							return { output: `File contents were withheld because the resolved file changed during the read: ${targetPath}. Request approval again before retrying.` };
						}
					}
					const text = new TextDecoder().decode(data.value.buffer);
					const lines = text.split('\n');
					const start = Math.max(1, typeof args?.startLine === 'number' ? args.startLine : 1);
					const end = Math.min(lines.length, typeof args?.endLine === 'number' ? args.endLine : lines.length);
					const numbered = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
					return { output: numbered || '(File is empty)' };
				} catch (e: any) {
					return { output: `Error reading file ${targetPath}: ${formatAgentToolError(e)}` };
				}
			}
			case 'write_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const targetPath = extractAgentFilePath(args);
				if (!targetPath) return { output: 'Error: Missing filePath parameter.' };
				const target = resolveUri(targetPath);
				try {
					let isNew = true;
					let initialContent: string | undefined;
					try {
						if (await fileService.exists(target)) {
							isNew = false;
							const oldData = await fileService.readFile(target);
							initialContent = new TextDecoder().decode(oldData.value.buffer);
						}
					} catch { }

					const content = typeof args?.content === 'string' ? args.content : (args?.content != null ? String(args.content) : '');
					const parent = dirname(target);
					if (!(await fileService.exists(parent))) {
						await fileService.createFolder(parent);
					}
					await fileService.writeFile(target, VSBuffer.fromString(content));
					const diff = isNew
						? { added: content ? content.split(/\r\n|\r|\n/).length : 0, removed: 0 }
						: computeAgentFileDiff(initialContent ?? '', content);
					return {
						output: `Successfully wrote ${content.length} bytes to ${targetPath}`,
						externalEdit: {
							uri: target,
							editKind: isNew ? 'create' : 'edit',
							initialContent: isNew ? undefined : initialContent,
							diff
						}
					};
				} catch (e: any) {
					return { output: `Error writing file ${targetPath}: ${formatAgentToolError(e)}` };
				}
			}
			case 'edit_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const targetPath = extractAgentFilePath(args);
				if (!targetPath) return { output: 'Error: Missing filePath parameter.' };
				const target = resolveUri(targetPath);
				try {
					if (!args?.searchContent && args?.content) {
						let initialContent: string | undefined;
						try {
							if (await fileService.exists(target)) {
								const oldData = await fileService.readFile(target);
								initialContent = new TextDecoder().decode(oldData.value.buffer);
							}
						} catch { }
						const parent = dirname(target);
						if (!(await fileService.exists(parent))) {
							await fileService.createFolder(parent);
						}
						const newContent = typeof args.content === 'string' ? args.content : String(args.content);
						await fileService.writeFile(target, VSBuffer.fromString(newContent));
						const diff = computeAgentFileDiff(initialContent ?? '', newContent);
						return {
							output: `Successfully updated ${targetPath}`,
							externalEdit: {
								uri: target,
								editKind: 'edit',
								initialContent,
								diff
							}
						};
					}
					const data = await fileService.readFile(target);
					const initialContent = new TextDecoder().decode(data.value.buffer);
					const fileUsesCRLF = initialContent.includes('\r\n');
					let text = initialContent;
					const search = (args?.searchContent ?? '').replace(/\r\n/g, '\n');
					const replace = (args?.replaceContent ?? '').replace(/\r\n/g, '\n');
					if (!search.trim()) {
						return { output: `Error: searchContent cannot be empty. Specify the exact existing text to replace in ${targetPath}.` };
					}
					const normText = text.replace(/\r\n/g, '\n');

					if (!normText.includes(search)) {
						const trimmedSearch = search.trim();
						if (!normText.includes(trimmedSearch)) {
							return { output: `Error: searchContent not found in ${targetPath}. Ensure searchContent matches the existing file exactly.` };
						}
						text = normText.replace(trimmedSearch, replace);
					} else {
						text = normText.replace(search, replace);
					}
					if (fileUsesCRLF) {
						text = text.replace(/\r?\n/g, '\r\n');
					}

					await fileService.writeFile(target, VSBuffer.fromString(text));
					const diff = computeAgentFileDiff(initialContent, text);
					return {
						output: `Successfully applied edits to ${targetPath}`,
						externalEdit: {
							uri: target,
							editKind: 'edit',
							initialContent,
							diff
						}
					};
				} catch (e: any) {
					return { output: `Error editing file ${targetPath}: ${formatAgentToolError(e)}` };
				}
			}
			case 'list_directory': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const dirCandidate = extractAgentFilePath(args) || (typeof args?.dirPath === 'string' ? args.dirPath.trim() : (typeof args?.path === 'string' ? args.path.trim() : '.'));
				const target = resolveUri(dirCandidate || '.');
				try {
					const res = await fileService.resolve(target);
					if (!res.children || res.children.length === 0) return { output: `Directory is empty: ${dirCandidate || '.'}` };
					const items = res.children.map(c => `${c.isDirectory ? '[DIR]' : '[FILE]'} ${c.name}${c.size ? ` (${c.size} bytes)` : ''}`);
					return { output: items.join('\n') };
				} catch (e: any) {
					return { output: `Error listing directory ${dirCandidate}: ${formatAgentToolError(e)}` };
				}
			}
			case 'glob':
			case 'find_files': {
				if (!fileService || !rootUri) return { output: 'Error: fileService unavailable or no open workspace' };
				const matched: string[] = [];
				const pat = (args.pattern || args.query || args.glob || '').toLowerCase().replace(/^\*+/, '').replace(/\*+$/, '');
				const scan = async (uri: URI, depth: number) => {
					if (depth > 4 || matched.length > 40) return;
					try {
						const res = await fileService!.resolve(uri);
						if (!res.children) return;
						for (const c of res.children) {
							if (c.name === 'node_modules' || c.name === '.git' || c.name === 'dist') continue;
							if (c.isDirectory) {
								await scan(c.resource, depth + 1);
							} else {
								if (c.name.toLowerCase().includes(pat) || c.resource.path.toLowerCase().includes(pat)) {
									const rel = c.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '');
									matched.push(rel);
								}
							}
						}
					} catch { }
				};
				await scan(rootUri, 0);
				return { output: matched.length > 0 ? matched.join('\n') : `No files found matching: ${args.pattern || args.query || args.glob}` };
			}
			case 'grep':
			case 'search_code': {
				if (!fileService || !rootUri) return { output: 'Error: fileService unavailable or no open workspace' };
				const results: string[] = [];
				const qLower = (args.query || args.pattern || args.text || '').toLowerCase();
				const scan = async (uri: URI, depth: number) => {
					if (depth > 3 || results.length > 25) return;
					try {
						const res = await fileService!.resolve(uri);
						if (!res.children) return;
						for (const c of res.children) {
							if (c.name === 'node_modules' || c.name === '.git' || c.name === 'dist' || c.name.endsWith('.lock')) continue;
							if (c.isDirectory) {
								await scan(c.resource, depth + 1);
							} else if (/\.(tsx?|jsx?|html?|css|json|md|py|rs|go|java|c|cpp)$/i.test(c.name)) {
								try {
									const buf = await fileService!.readFile(c.resource);
									const txt = new TextDecoder().decode(buf.value.buffer);
									const lines = txt.split('\n');
									for (let i = 0; i < lines.length; i++) {
										if (lines[i].toLowerCase().includes(qLower)) {
											const rel = c.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '');
											results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
											if (results.length >= 25) break;
										}
									}
								} catch { }
							}
						}
					} catch { }
				};
				await scan(rootUri, 0);
				return { output: results.length > 0 ? results.join('\n') : `No code matches found for: ${args.query}` };
			}
			case 'run_command':
			case 'run_in_terminal': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const termService = accessor.get(ITerminalService);
							const cmdTrim = (args.command || args.commandLine || '').trim();

							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}

							const isServerCmd = /\b(npm\s+(run\s+)?(dev|start|serve)|npx\s+(vite|next|live-server|http-server)|vite|next\s+dev|nuxt|webpack\s+serve|live-server|http-server|nodemon)\b/i.test(cmdTrim);

							if (isServerCmd) {
								let term = termService.activeInstance;
								if (!term || term.isDisposed) {
									term = await termService.createTerminal({
										config: {
											name: `Dev Server`,
											hideFromUser: false,
											isFeatureTerminal: false,
											cwd: rootUri ? rootUri.fsPath : undefined,
										}
									});
								}
								termService.setActiveInstance(term);
								try { term.focus?.(); } catch { }

								let serverOutput = '';
								const dataListener = term.onData?.((data: string) => {
									serverOutput += data;
								});

								await term.sendText(cmdTrim, true);

								await new Promise<void>(resolve => {
									const timer = setTimeout(resolve, 4000);
									const checkInterval = setInterval(() => {
										if (/(localhost:\d+|127\.0\.0\.1:\d+|ready in \d+|serving at|Local:)/i.test(serverOutput)) {
											clearTimeout(timer);
											clearInterval(checkInterval);
											resolve();
										}
									}, 250);
								});

								try { dataListener?.dispose?.(); } catch { }

								const cleanOutput = serverOutput
									.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
									.replace(/\r\n/g, '\n')
									.replace(/\r/g, '\n')
									.trim();

								outputMsg = `Development server launched in terminal panel.\nCommand: ${cmdTrim}\nInitial Output:\n${cleanOutput || 'Server process started in active terminal.'}`;
							} else if (termService.createTerminal) {
								const isWin = isWindows;
								let effectiveCmd = cmdTrim;
								if (isWin) {
									effectiveCmd = effectiveCmd
										.replace(/\s*&&\s*/g, ' ; ')
										.replace(/\s*2>\s*\/dev\/null/g, ' 2>$null')
										.replace(/\s*>\s*\/dev\/null/g, ' >$null')
										.replace(/\bwhich\s+([a-zA-Z0-9_\-\.]+)/g, '(Get-Command $1 -ErrorAction SilentlyContinue).Path')
										.replace(/\bls\s+\/app\b/g, 'Get-ChildItem -ErrorAction SilentlyContinue');
								}
								const executable = isWin ? 'powershell.exe' : '/bin/sh';
								const shellArgs = isWin ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', effectiveCmd] : ['-c', cmdTrim];
								const term = await termService.createTerminal({
									config: {
										name: 'Agent Task',
										hideFromUser: true,
										isFeatureTerminal: true,
										cwd: rootUri ? rootUri.fsPath : undefined,
										executable,
										args: shellArgs,
									}
								});

								let bufferedOutput = '';
								const dataListener = term.onData?.((data: string) => {
									bufferedOutput += data;
								});

								let exitCode: number | undefined;
								let launchError: string | undefined;
								let timedOut = false;
								await new Promise<void>(resolve => {
									let exitListener: any;
									let timer: any;
									const cleanup = () => {
										try { exitListener?.dispose?.(); } catch { }
										if (timer) { clearTimeout(timer); }
										resolve();
									};
									if (term.onExit) {
										exitListener = term.onExit((code: any) => {
											if (typeof code === 'number') {
												exitCode = code;
											} else if (code && typeof code === 'object') {
												launchError = code.message || JSON.stringify(code);
												exitCode = code.code ?? -1;
											}
											// Buffer flush delay: allow ConPTY and IPC pipe to flush final data chunks
											setTimeout(cleanup, 250);
										});
									}
									timer = setTimeout(() => {
										timedOut = true;
										cleanup();
									}, 180000);
								});

								try { dataListener?.dispose?.(); } catch { }
								try { term.dispose?.(); } catch { }

								let cleanOutput = bufferedOutput
									.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
									.replace(/\r\n/g, '\n')
									.replace(/\r/g, '\n')
									.trim();

								if (cleanOutput.length > 25000) {
									const outLines = cleanOutput.split('\n');
									if (outLines.length > 180) {
										const head = outLines.slice(0, 50).join('\n');
										const tail = outLines.slice(-100).join('\n');
										cleanOutput = `${head}\n\n... [${outLines.length - 150} lines truncated for token optimization] ...\n\n${tail}`;
									}
								}

								if (launchError) {
									outputMsg = `Terminal launch error: ${launchError}`;
								} else if (timedOut) {
									outputMsg = `Command timed out after 180s. Output so far:\n${cleanOutput || '(no output)'}`;
								} else if (exitCode !== undefined && exitCode !== 0) {
									outputMsg = `Command failed with exit code ${exitCode}.\nOutput:\n${cleanOutput || '(no output)'}`;
								} else if (exitCode === 0) {
									outputMsg = cleanOutput
										? `${cleanOutput}\n\n[Command executed successfully with exit code 0]`
										: `[Command executed successfully with exit code 0 (no output produced)]`;
								} else {
									outputMsg = cleanOutput || `Command completed.`;
								}
							} else if (termService.getActiveOrCreateInstance) {
								const term = await termService.getActiveOrCreateInstance({ acceptsInput: true });
								term.runCommand?.(cmdTrim, true);
								outputMsg = `Dispatched to terminal: ${cmdTrim}`;
							}
						} catch (err: any) {
							outputMsg = `Terminal execution error: ${formatAgentToolError(err)}`;
						}
					});
					return { output: outputMsg || `Executed command: ${args.command || args.commandLine}` };
				} catch (e: any) {
					return { output: `Error running command: ${formatAgentToolError(e)}` };
				}
			}
			case 'send_to_terminal': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const termService = accessor.get(ITerminalService);
							const textToSend = (args.text || args.command || args.commandLine || '').trim();
							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}
							const term = termService.activeInstance || (termService.getActiveOrCreateInstance ? await termService.getActiveOrCreateInstance({ acceptsInput: true }) : undefined);
							if (!term) {
								outputMsg = 'No active terminal available.';
								return;
							}
							await term.sendText(textToSend, args.addNewLine !== false);
							outputMsg = `Sent to terminal: ${textToSend}`;
						} catch (err: any) {
							outputMsg = `Terminal error: ${formatAgentToolError(err)}`;
						}
					});
					return { output: outputMsg || 'Sent command to terminal' };
				} catch (e: any) {
					return { output: `Error sending to terminal: ${formatAgentToolError(e)}` };
				}
			}
			case 'get_terminal_output': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const termService = accessor.get(ITerminalService);
							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}
							const term = termService.activeInstance;
							if (!term) {
								outputMsg = 'No active terminal instance found.';
								return;
							}
							const xterm = (term as any).xterm;
							if (xterm && xterm.raw) {
								const buffer = xterm.raw.buffer.active;
								const lines: string[] = [];
								for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
									const line = buffer.getLine(i);
									if (line) lines.push(line.translateToString(true));
								}
								outputMsg = lines.join('\n').trim();
							} else {
								outputMsg = 'Terminal buffer not accessible or empty.';
							}
						} catch (err: any) {
							outputMsg = `Error reading terminal output: ${formatAgentToolError(err)}`;
						}
					});
					return { output: outputMsg || 'Terminal output retrieved' };
				} catch (e: any) {
					return { output: `Error getting terminal output: ${formatAgentToolError(e)}` };
				}
			}
			case 'kill_terminal': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const termService = accessor.get(ITerminalService);
							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}
							const term = termService.activeInstance;
							if (!term) {
								outputMsg = 'No active terminal to kill.';
								return;
							}
							term.dispose();
							outputMsg = 'Active terminal terminated.';
						} catch (err: any) {
							outputMsg = `Error killing terminal: ${formatAgentToolError(err)}`;
						}
					});
					return { output: outputMsg || 'Terminal closed' };
				} catch (e: any) {
					return { output: `Error terminating terminal: ${formatAgentToolError(e)}` };
				}
			}
			case 'manage_todo_list':
			case 'todo':
			case 'todo_list':
			case 'update_todo_list':
			case 'dardcor_internal_todo': {
				try {
					if (!chatSessionResource) {
						return { output: 'Error: chat session is unavailable; checklist was not saved.' };
					}
					let todoService: IChatTodoListService | undefined;
					try {
						this.instantiationService.invokeFunction(accessor => todoService = accessor.get(IChatTodoListService));
					} catch { }
					if (!todoService) {
						return { output: 'Error: checklist storage is unavailable; checklist was not saved.' };
					}

					const normalized = normalizeTodoListArgs(args);
					const existingTodos = todoService.getTodos(chatSessionResource);

					if (normalized.operation === 'read' || (normalized.items.length === 0 && (args?.operation === 'read' || args?.action === 'read' || args?.action === 'get'))) {
						if (existingTodos.length > 0) {
							const rendered = existingTodos.map(item => {
								const icon = item.status === 'completed' ? '[x]' : item.status === 'in-progress' ? '[~]' : '[ ]';
								return `${icon} ${item.id}. ${item.title} (${item.status})`;
							}).join('\n');
							const activeItem = existingTodos.find(item => item.status === 'in-progress') ?? existingTodos.find(item => item.status === 'not-started');
							const directive = activeItem
								? `\n\n[SYSTEM DIRECTIVE]: Immediately proceed with the active task #${activeItem.id}: "${activeItem.title}". Call the relevant concrete action tool (e.g. read_file, edit_file, run_command) now without yielding or asking permission.`
								: '\n\n[SYSTEM DIRECTIVE]: All checklist items appear completed. Run comprehensive verification tests before calling task_completed.';
							return { output: `Current task checklist (${existingTodos.length} items):\n${rendered}${directive}` };
						}
						return {
							output: 'No task checklist items are currently tracked. To initialize a checklist, provide an array of items: { todoList: [{ id: 1, title: "Task description", status: "in-progress" }] }. You may also proceed directly with action tools (read_file, run_command).'
						};
					}

					if (normalized.items.length === 0) {
						if (existingTodos.length > 0) {
							const rendered = existingTodos.map(item => {
								const icon = item.status === 'completed' ? '[x]' : item.status === 'in-progress' ? '[~]' : '[ ]';
								return `${icon} ${item.id}. ${item.title} (${item.status})`;
							}).join('\n');
							const activeItem = existingTodos.find(item => item.status === 'in-progress') ?? existingTodos.find(item => item.status === 'not-started');
							const directive = activeItem
								? `\n\n[SYSTEM DIRECTIVE]: Checklist update contained no parseable items; existing checklist was preserved. Immediately proceed with the active task #${activeItem.id}: "${activeItem.title}". Invoke concrete action tools now.`
								: '\n\n[SYSTEM DIRECTIVE]: All checklist items appear completed. Run comprehensive verification tests before calling task_completed.';
							return { output: `Checklist update noted (no new items parsed; existing ${existingTodos.length} items preserved):\n${rendered}${directive}` };
						}
						return {
							output: 'Checklist update received with no parseable items. Provide items with id, title, and status: { todoList: [{ id: 1, title: "Task description", status: "in-progress" }] }. If a checklist is not required, proceed directly using concrete action tools.'
						};
					}

					const list = normalized.items;
					todoService.setTodos(chatSessionResource, list);
					const rendered = list.map(item => {
						const icon = item.status === 'completed' ? '[x]' : item.status === 'in-progress' ? '[~]' : '[ ]';
						return `${icon} ${item.id}. ${item.title} (${item.status})`;
					}).join('\n');
					const activeItem = list.find(item => item.status === 'in-progress') ?? list.find(item => item.status === 'not-started');
					const directive = activeItem
						? `\n\n[SYSTEM DIRECTIVE]: Immediately proceed with the active task #${activeItem.id}: "${activeItem.title}". Call the relevant concrete action tool (e.g. read_file, edit_file, run_command) now without yielding or asking permission.`
						: '\n\n[SYSTEM DIRECTIVE]: All checklist items appear completed. Run comprehensive verification tests before calling task_completed.';
					return { output: `Todo checklist updated:\n${rendered}${directive}` };
				} catch (e: any) {
					return { output: `Error updating todo list: ${formatAgentToolError(e)}` };
				}
			}
			case 'fetch_web_page': {
				const rawUrl = args.url || (Array.isArray(args.urls) ? args.urls[0] : '');
				if (!rawUrl) return { output: 'Error: No URL provided' };
				try {
					const res = await fetch(rawUrl, {
						headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DardcorCode/1.0' }
					});
					if (!res.ok) {
						return { output: `HTTP error ${res.status}: ${res.statusText}` };
					}
					const text = await res.text();
					const cleanText = text
						.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
						.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
						.replace(/<[^>]+>/g, ' ')
						.replace(/\s+/g, ' ')
						.trim();
					const truncated = cleanText.length > 8000 ? cleanText.slice(0, 8000) + '... (truncated)' : cleanText;
					return { output: truncated || '(Page returned no readable text)' };
				} catch (e: any) {
					return { output: `Error fetching URL ${rawUrl}: ${formatAgentToolError(e)}` };
				}
			}
			case 'delete_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const targetPath = extractAgentFilePath(args);
				if (!targetPath) return { output: 'Error: Missing filePath parameter.' };
				const target = resolveUri(targetPath);
				try {
					if (!(await fileService.exists(target))) {
						return { output: `File or directory not found: ${targetPath}` };
					}
					const stat = await fileService.resolve(target);
					const isDir = stat.isDirectory;
					let removedLines = 0;
					let initialContent: string | undefined;
					if (!isDir) {
						try {
							const fileData = await fileService.readFile(target);
							initialContent = new TextDecoder().decode(fileData.value.buffer);
							removedLines = initialContent.split('\n').length;
						} catch { }
					}
					await fileService.del(target, { recursive: args?.recursive !== false });
					return {
						output: `Successfully deleted ${isDir ? 'directory' : 'file'}: ${targetPath}`,
						externalEdit: isDir ? undefined : {
							uri: target,
							editKind: 'delete',
							initialContent,
							diff: { added: 0, removed: removedLines }
						}
					};
				} catch (e: any) {
					return { output: `Error deleting ${targetPath}: ${formatAgentToolError(e)}` };
				}
			}
			case 'rename_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const oldPath = extractAgentFilePath(args?.oldFilePath ?? args?.oldPath ?? args?.source ?? args?.from);
				const newPath = extractAgentFilePath(args?.newFilePath ?? args?.newPath ?? args?.target ?? args?.to);
				if (!oldPath || !newPath) return { output: 'Error: Both oldFilePath and newFilePath are required.' };
				const source = resolveUri(oldPath);
				const target = resolveUri(newPath);
				try {
					if (!(await fileService.exists(source))) {
						return { output: `Source file not found: ${oldPath}` };
					}
					const targetParent = dirname(target);
					if (!(await fileService.exists(targetParent))) {
						await fileService.createFolder(targetParent);
					}
					await fileService.move(source, target, !!args?.overwrite);
					return {
						output: `Successfully renamed ${oldPath} to ${newPath}`
					};
				} catch (e: any) {
					return { output: `Error renaming ${oldPath}: ${formatAgentToolError(e)}` };
				}
			}
			case 'get_diagnostics': {
				let markerService: IMarkerService | undefined;
				try {
					this.instantiationService.invokeFunction(accessor => {
						try { markerService = accessor.get(IMarkerService); } catch { }
					});
				} catch { }
				if (!markerService) return { output: 'Error: markerService unavailable' };
				try {
					let targetUri: URI | undefined;
					const targetPath = extractAgentFilePath(args);
					if (targetPath) {
						targetUri = resolveUri(targetPath);
					}
					const markers = markerService.read({ resource: targetUri });
					const filterSev = args?.severity || 'all';
					const filtered = markers.filter(m => {
						if (filterSev === 'error') return m.severity === MarkerSeverity.Error;
						if (filterSev === 'warning') return m.severity === MarkerSeverity.Warning;
						return m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning || m.severity === MarkerSeverity.Info;
					});
					if (filtered.length === 0) {
						return { output: targetPath ? `No diagnostic problems (errors/warnings) found for ${targetPath}.` : 'No diagnostic problems (errors/warnings) found in workspace.' };
					}
					const formatted = filtered.slice(0, 50).map(m => {
						const rel = rootUri ? m.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '') : m.resource.path;
						const sevStr = m.severity === MarkerSeverity.Error ? 'ERROR' : m.severity === MarkerSeverity.Warning ? 'WARNING' : 'INFO';
						return `[${sevStr}] ${rel}:${m.startLineNumber}:${m.startColumn} - ${m.message}${m.source ? ` (${m.source})` : ''}`;
					});
					return {
						output: `Found ${filtered.length} diagnostic issue(s)${filtered.length > 50 ? ' (showing first 50)' : ''}:\n${formatted.join('\n')}`
					};
				} catch (e: any) {
					return { output: `Error reading diagnostics: ${formatAgentToolError(e)}` };
				}
			}
			case 'get_file_outline': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const targetPath = extractAgentFilePath(args);
				if (!targetPath) return { output: 'Error: Missing filePath parameter.' };
				const target = resolveUri(targetPath);
				try {
					if (!(await fileService.exists(target))) {
						return { output: `File not found: ${targetPath}` };
					}
					const data = await fileService.readFile(target);
					const text = new TextDecoder().decode(data.value.buffer);
					const lines = text.split('\n');
					const symbols: string[] = [];

					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
							continue;
						}

						if (/^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+([a-zA-Z0-9_$]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^(def|class)\s+([a-zA-Z0-9_]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/:.*$/, '').trim()}`);
						} else if (/^(pub\s+)?(fn|struct|enum|trait|impl|type)\s+([a-zA-Z0-9_]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^func\s+(\([^)]+\)\s+)?([a-zA-Z0-9_]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^(public|private|protected|static|override|async|\s)+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[:{]/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^#{1,4}\s+(.*)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed}`);
						}
					}

					if (symbols.length === 0) {
						return { output: `No structural symbols found in ${targetPath} (file has ${lines.length} lines).` };
					}

					return {
						output: `Outline of ${targetPath} (${symbols.length} symbols):\n${symbols.slice(0, 80).join('\n')}`
					};
				} catch (e: any) {
					return { output: `Error extracting outline for ${targetPath}: ${formatAgentToolError(e)}` };
				}
			}
			case 'grep_search': {
				if (!fileService || !rootUri) return { output: 'Error: fileService unavailable or no open workspace' };
				const patStr = typeof args?.pattern === 'string' ? args.pattern : '';
				if (!patStr) return { output: 'Error: No search pattern provided' };
				const isRegex = !!args?.isRegex;
				const caseInsensitive = args?.caseInsensitive !== false;
				let regex: RegExp;
				try {
					regex = isRegex ? new RegExp(patStr, caseInsensitive ? 'i' : '') : new RegExp(patStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'i' : '');
				} catch (err: any) {
					return { output: `Invalid regex pattern: ${formatAgentToolError(err)}` };
				}

				const subCandidate = extractAgentFilePath(args?.subPath) || (typeof args?.subPath === 'string' ? args.subPath.trim() : undefined);
				const searchBase = subCandidate ? resolveUri(subCandidate) : rootUri;
				const matches: string[] = [];
				const ignoreList = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'out', 'coverage']);

				const scanDir = async (dirUri: URI, depth: number) => {
					if (depth > 6 || matches.length >= 60) return;
					try {
						const res = await fileService!.resolve(dirUri);
						if (!res.children) return;
						for (const c of res.children) {
							if (ignoreList.has(c.name) || c.name.endsWith('.lock')) continue;
							if (c.isDirectory) {
								await scanDir(c.resource, depth + 1);
							} else if (/\.(tsx?|jsx?|html?|css|scss|json|md|py|rs|go|java|c|cpp|h|php|yaml|yml|toml|sh|bat|ps1)$/i.test(c.name)) {
								try {
									const buf = await fileService!.readFile(c.resource);
									const txt = new TextDecoder().decode(buf.value.buffer);
									const lines = txt.split('\n');
									const rel = c.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '');
									for (let i = 0; i < lines.length; i++) {
										if (regex.test(lines[i])) {
											matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
											if (matches.length >= 60) break;
										}
									}
								} catch { }
							}
						}
					} catch { }
				};

				await scanDir(searchBase, 0);
				return {
					output: matches.length > 0
						? `Found ${matches.length} match(es)${matches.length >= 60 ? ' (capped at 60)' : ''}:\n${matches.join('\n')}`
						: `No matches found for pattern "${patStr}"`
				};
			}
			case 'terminal_selection': {
				let selection = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const termService = accessor.get(ITerminalService);
						if (!termService) return;
						const term = termService.activeInstance;
						if (term && term.selection) {
							selection = term.selection;
						}
					} catch { }
				});
				return {
					output: selection ? `Active terminal selection:\n${selection}` : 'No text is currently selected in the active terminal.'
				};
			}
			case 'terminal_last_command': {
				let result = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const termService = accessor.get(ITerminalService);
						if (!termService) return;
						const term = termService.activeInstance;
						if (!term) {
							result = 'No active terminal instance found.';
							return;
						}
						const commandDetection = term.capabilities?.get?.(TerminalCapability.CommandDetection);
						if (commandDetection) {
							if (commandDetection.executingCommand) {
								result = `Command currently executing:\n${commandDetection.executingCommand}${commandDetection.cwd ? `\nDirectory: ${commandDetection.cwd}` : ''}`;
								return;
							}
							const commands = commandDetection.commands;
							if (commands && commands.length > 0) {
								const lastCmd = commands[commands.length - 1];
								const lines: string[] = [];
								if (lastCmd.command) lines.push(`Last command: ${lastCmd.command}`);
								if (lastCmd.cwd) lines.push(`Directory: ${lastCmd.cwd}`);
								if (lastCmd.exitCode !== undefined) lines.push(`Exit code: ${lastCmd.exitCode}`);
								if (lastCmd.hasOutput?.() && lastCmd.getOutput) {
									const out = lastCmd.getOutput();
									if (out && out.trim().length > 0) lines.push(`Output:\n${out.trim()}`);
								}
								result = lines.join('\n');
								return;
							}
						}
						const xterm = (term as any).xterm;
						if (xterm && xterm.raw) {
							const buffer = xterm.raw.buffer.active;
							const lines: string[] = [];
							for (let i = Math.max(0, buffer.length - 30); i < buffer.length; i++) {
								const line = buffer.getLine(i);
								if (line) lines.push(line.translateToString(true));
							}
							result = lines.join('\n').trim();
						}
					} catch { }
				});
				return {
					output: result || 'No command has been run in the active terminal.'
				};
			}
			case 'create_and_run_task': {
				let outputMsg = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const termService = accessor.get(ITerminalService);
						const label = args.label || args.name || 'temporary_task';
						const command = args.command || '';
						const fullCmd = Array.isArray(args.args) && args.args.length > 0
							? `${command} ${args.args.join(' ')}`
							: command;

						if (!fullCmd.trim()) {
							outputMsg = 'No command provided for task execution.';
							return;
						}

						if (termService) {
							const isBg = !!args.isBackground || /(?:serve|watch|dev|start)\b/i.test(fullCmd);
							if (isBg) {
								const term = await (termService.getActiveOrCreateInstance
									? termService.getActiveOrCreateInstance({ acceptsInput: true })
									: termService.activeInstance);
								if (term) {
									term.focus?.();
									term.runCommand?.(fullCmd.trim(), true);
									outputMsg = `Background task '${label}' dispatched to terminal: ${fullCmd.trim()}`;
								} else {
									outputMsg = `No terminal instance available to run background task '${label}'.`;
								}
							} else if (termService.createTerminal) {
								const isWin = isWindows;
								const effectiveCmd = fullCmd.trim();
								const executable = isWin ? 'powershell.exe' : '/bin/sh';
								const shellArgs = isWin ? ['-NoProfile', '-Command', effectiveCmd] : ['-c', fullCmd.trim()];
								const term = await termService.createTerminal({
									config: {
										name: label,
										hideFromUser: true,
										isFeatureTerminal: true,
										cwd: rootUri ? rootUri.fsPath : undefined,
										executable,
										args: shellArgs,
									}
								});

								let bufferedOutput = '';
								const dataListener = term.onData?.((data: string) => {
									bufferedOutput += data;
								});

								let exitCode: number | undefined;
								let timedOut = false;
								await new Promise<void>(resolve => {
									let exitListener: any;
									let timer: any;
									let cancellationListener: IDisposable | undefined;
									const cleanup = () => {
										try { exitListener?.dispose?.(); } catch { }
										try { cancellationListener?.dispose(); } catch { }
										if (timer) { clearTimeout(timer); }
										resolve();
									};
									if (term.onExit) {
										exitListener = term.onExit((code: any) => {
											if (typeof code === 'number') {
												exitCode = code;
											} else if (code && typeof code === 'object') {
												exitCode = code.code ?? -1;
											}
											cleanup();
										});
									}
									if (!term.onExit) {
										timedOut = true;
										cleanup();
										return;
									}
									timer = setTimeout(() => {
										timedOut = true;
										cleanup();
									}, 180000);
									cancellationListener = token.onCancellationRequested(() => {
										timedOut = true;
										cleanup();
									});
									if (token.isCancellationRequested) {
										timedOut = true;
										cleanup();
									}
								});

								try { dataListener?.dispose?.(); } catch { }
								try { term.dispose?.(); } catch { }

								const cleanOutput = bufferedOutput
									.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
									.replace(/\r\n/g, '\n')
									.replace(/\r/g, '\n')
									.trim();

								if (timedOut || token.isCancellationRequested) {
									outputMsg = `Task '${label}' was cancelled or reached the 180-second limit before a final status was available. Its result is inconclusive; inspect the task output before retrying.\nCommand: ${fullCmd}\nOutput:\n${cleanOutput || '(no output)'}`;
								} else if (exitCode === undefined) {
									outputMsg = `Task '${label}' ended, but its final exit status is unknown. Success is not confirmed; inspect the task output.\nCommand: ${fullCmd}\nOutput:\n${cleanOutput || '(no output)'}`;
								} else if (exitCode === 0) {
									outputMsg = `Task '${label}' executed successfully. Exit code: 0\nCommand: ${fullCmd}\nOutput:\n${cleanOutput || '(completed)'}`;
								} else {
									outputMsg = `Task '${label}' failed with exit code ${exitCode}.\nCommand: ${fullCmd}\nOutput:\n${cleanOutput || '(no output)'}`;
								}
							} else {
								const term = await termService.getActiveOrCreateInstance?.({ acceptsInput: true });
								if (term) {
									term.runCommand?.(fullCmd.trim(), true);
									outputMsg = `Task '${label}' dispatched to terminal: ${fullCmd.trim()}`;
								} else {
									outputMsg = `Terminal service unavailable.`;
								}
							}
						} else {
							outputMsg = `Terminal service unavailable.`;
						}
					} catch (err: any) {
						outputMsg = `Error executing task: ${formatAgentToolError(err)}`;
					}
				});
				return { output: outputMsg || 'Task execution finished' };
			}
			case 'run_task': {
				let outputMsg = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const taskService = accessor.get(ITaskService);
						if (!taskService) {
							outputMsg = 'Task service is not available.';
							return;
						}
						const label = args.taskLabel || args.label || args.name || '';
						const availableTasks = await taskService.tasks();
						const targetTask = availableTasks?.find(t => t._label === label || (t as any).configurationProperties?.name === label);
						if (!targetTask) {
							outputMsg = `Task '${label}' not found among available tasks: ${availableTasks?.map(t => t._label).filter(Boolean).join(', ') || 'none'}`;
							return;
						}
						const summary = await taskService.run(targetTask);
						if (typeof summary?.exitCode !== 'number') {
							outputMsg = `Task '${label}' finished, but its final exit status is unknown. Success is not confirmed; inspect its terminal output.`;
						} else if (summary.exitCode === 0) {
							outputMsg = `Task '${label}' executed successfully. Exit code: 0`;
						} else {
							outputMsg = `Task '${label}' failed. Exit code: ${summary.exitCode}`;
						}
					} catch (err: any) {
						outputMsg = `Error running task: ${formatAgentToolError(err)}`;
					}
				});
				return { output: outputMsg || 'Task finished' };
			}
			case 'get_task_output': {
				let outputMsg = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const taskService = accessor.get(ITaskService);
						const termService = accessor.get(ITerminalService);
						if (!taskService || !termService) {
							outputMsg = 'Task service or terminal service unavailable.';
							return;
						}
						const label = args.taskLabel || args.label || '';
						const availableTasks = await taskService.tasks();
						const targetTask = availableTasks?.find(t => t._label === label || (t as any).configurationProperties?.name === label);
						if (!targetTask) {
							outputMsg = `Task '${label}' not found.`;
							return;
						}
						const terminalUris = taskService.getTerminalsForTasks([targetTask]);
						if (terminalUris && terminalUris.length > 0) {
							const instances = termService.instances || [];
							const matchedTerm = instances.find((inst: any) => terminalUris.some(u => inst.resource?.toString() === u.toString() || inst.title === label));
							if (matchedTerm && (matchedTerm as any).xterm?.raw) {
								const buffer = (matchedTerm as any).xterm.raw.buffer.active;
								const lines: string[] = [];
								for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
									const line = buffer.getLine(i);
									if (line) lines.push(line.translateToString(true));
								}
								outputMsg = lines.join('\n').trim();
							}
						}
						if (!outputMsg) {
							outputMsg = `No output captured yet for task '${label}'.`;
						}
					} catch (err: any) {
						outputMsg = `Error getting task output: ${formatAgentToolError(err)}`;
					}
				});
				return { output: outputMsg };
			}
			case 'ask_questions': {
				return { output: 'Question tool was not connected to the chat response UI. No answer was assumed; retry after the question carousel is available.' };
			}
			case 'review_plan': {
				return { output: 'Plan review was not connected to the chat response UI. No approval was assumed; retry when plan review is available.' };
			}
			case 'run_subagent': {
				return this._invokeBuiltinAgentTool('runSubagent', {
					prompt: String(args?.prompt ?? ''),
					description: String(args?.description ?? 'subagent task'),
					agentName: typeof args?.agentName === 'string' ? args.agentName : undefined,
					model: typeof args?.model === 'string' ? args.model : undefined,
				}, chatSessionResource, rootUri, requestId, token);
			}
			case 'confirm_terminal_command': {
				return { output: 'Command confirmation was not connected to the chat response UI. No command was authorized or run.' };
			}
			case 'set_artifacts': {
				if (!chatSessionResource || !Array.isArray(args?.artifacts)) {
					return { output: 'Artifacts were not updated: a chat session and an artifacts array are required.' };
				}
				try {
					const artifacts: IChatArtifact[] = [];
					for (const artifact of args.artifacts) {
						if (!artifact || typeof artifact.label !== 'string' || !artifact.label.trim()) {
							throw new Error('Every artifact requires a non-empty label.');
						}
						const uri = typeof artifact.uri === 'string' ? artifact.uri : '';
						if (uri) {
							const parsed = URI.parse(uri);
							if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
								if (!fileService || !(await fileService.exists(parsed))) {
									throw new Error(`Artifact URI does not exist or cannot be checked: ${uri}`);
								}
							}
						}
						artifacts.push({
							label: artifact.label.trim(),
							uri,
							type: ['devServer', 'screenshot', 'plan'].includes(artifact.type) ? artifact.type : undefined,
							toolCallId: typeof artifact.toolCallId === 'string' ? artifact.toolCallId : undefined,
							dataPartIndex: typeof artifact.dataPartIndex === 'number' ? artifact.dataPartIndex : undefined,
						});
					}
					let artifactsService: IChatArtifactsService | undefined;
					this.instantiationService.invokeFunction(accessor => artifactsService = accessor.get(IChatArtifactsService));
					if (!artifactsService) {
						throw new Error('The chat artifacts service is unavailable.');
					}
					artifactsService.getArtifacts(chatSessionResource).setAgentArtifacts(artifacts);
					return { output: `Updated ${artifacts.length} session artifact(s).` };
				} catch (error) {
					return { output: `Artifacts were not updated: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
			case 'set_artifact_rules': {
				if (!chatSessionResource) {
					return { output: 'Artifact rules were not updated: this chat has no session resource.' };
				}
				try {
					const rules: IArtifactRuleOverrides = {};
					for (const group of ['byMimeType', 'byFilePath', 'byMemoryFilePath'] as const) {
						const source = args?.[group];
						if (source === undefined) {
							continue;
						}
						if (!source || typeof source !== 'object' || Array.isArray(source)) {
							throw new Error(`${group} must be an object mapping patterns to group configurations.`);
						}
						const normalized: Record<string, { groupName: string; onlyShowGroup?: boolean }> = {};
						for (const [pattern, config] of Object.entries(source)) {
							if (!config || typeof config !== 'object' || typeof (config as any).groupName !== 'string' || !(config as any).groupName.trim() || ((config as any).onlyShowGroup !== undefined && typeof (config as any).onlyShowGroup !== 'boolean')) {
								throw new Error(`Invalid artifact rule for pattern "${pattern}".`);
							}
							normalized[pattern] = { groupName: (config as any).groupName.trim(), onlyShowGroup: (config as any).onlyShowGroup };
						}
						(rules as any)[group] = normalized;
					}
					let artifactsService: IChatArtifactsService | undefined;
					this.instantiationService.invokeFunction(accessor => artifactsService = accessor.get(IChatArtifactsService));
					if (!artifactsService) {
						throw new Error('The chat artifacts service is unavailable.');
					}
					artifactsService.getArtifacts(chatSessionResource).setRuleOverrides(rules);
					return { output: 'Updated session artifact rules.' };
				} catch (error) {
					return { output: `Artifact rules were not updated: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
			case 'open_browser_page':
			case 'read_browser_page':
			case 'read_page':
			case 'navigate_browser':
			case 'navigate_page':
			case 'screenshot_browser_page':
			case 'screenshot_page':
			case 'click_element':
			case 'click_browser':
			case 'type_in_page':
			case 'type_browser':
			case 'scroll_browser_page':
			case 'scroll_page':
			case 'hover_element':
			case 'hover_browser':
			case 'press_key':
			case 'select_option':
			case 'drag_and_drop':
			case 'wait_for_browser':
			case 'execute_browser_script':
			case 'get_browser_console_logs':
			case 'handle_browser_dialog': {
				let output = '';
				let browserImage: { mimeType: 'image/png'; base64: string } | undefined;
				let executionStatus: AgentToolExecutionStatus | undefined;
				const { DardcorBrowserAgentController } = await import('./dardcorBrowserAgentController.js');
				try {


					const browserServices = this.instantiationService.invokeFunction(accessor => DardcorBrowserAgentController.resolveServices(accessor));
					const res = await DardcorBrowserAgentController.executeBrowserTool(browserServices, toolName, args, chatSessionResource?.toString() ?? 'dardcor-agent-session', token);
					output = res.output;
					executionStatus = res.executionStatus;
					if (res.image) {
						browserImage = res.image;
					}
				} catch (err: any) {
					output = `Browser Agent Error (${toolName}): ${formatAgentToolError(err)}. No successful browser verification was recorded.`;
					executionStatus = 'failed';
				}
				return { output, browserImage, executionStatus };
			}
			case 'task_completed':
			case 'complete_task': {
				const summary = typeof args?.summary === 'string' ? args.summary : 'Task completed successfully.';
				const verificationSteps = typeof args?.verificationSteps === 'string' ? args.verificationSteps : '';
				const filesChanged = Array.isArray(args?.filesChanged) ? args.filesChanged.join(', ') : '';
				const outputText = `### Completion Request Pending Verification\n\nThe request is not yet accepted. Runtime checklist, verification, browser evidence, and workspace diagnostics must pass.\n\n${summary}\n\n` +
					(verificationSteps ? `**Verification Steps:**\n${verificationSteps}\n\n` : '') +
					(filesChanged ? `**Files Modified/Created:**\n${filesChanged}\n` : '');
				return { output: outputText };
			}
			default:
				return { output: `Unknown tool: ${toolName}` };
		}
	}

	private _parseTextToolCalls(text: string): Array<{ name: string; args: any }> {
		const calls: Array<{ name: string; args: any }> = [];
		if (!text) return calls;


		const codeBlockRegex = /```(?:tool_call|json:tool|json)\s*([\s\S]*?)(?:```|$)/gi;
		let match: RegExpExecArray | null;
		while ((match = codeBlockRegex.exec(text)) !== null) {
			try {
				const trimmed = match[1].trim();
				const obj = JSON.parse(trimmed);
				if (Array.isArray(obj)) {
					for (const item of obj) {
						if (item?.name || item?.tool) {
							calls.push({ name: item.name || item.tool, args: item.arguments || item.args || item.parameters || {} });
						}
					}
				} else if (obj?.tool_calls && Array.isArray(obj.tool_calls)) {
					for (const tc of obj.tool_calls) {
						if (tc?.function?.name || tc?.name) {
							const args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || tc.args || {});
							calls.push({ name: tc.function?.name || tc.name, args });
						}
					}
				} else if (obj?.tool || obj?.name) {
					calls.push({
						name: obj.tool || obj.name,
						args: obj.arguments || obj.args || obj.parameters || obj
					});
				}
			} catch {
				const partial = match[1].trim();
				const name = partial.match(/["'](?:name|tool)["']\s*:\s*["']([^"']+)/i)?.[1];
				if (name) {
					calls.push({ name, args: partial });
				}
			}
		}


		const tagRegex = /<(?:tool_call|function_call|tool|invoke)>\s*([\s\S]*?)(?:\s*<\/(?:tool_call|function_call|tool|invoke)>|$)/gi;
		while ((match = tagRegex.exec(text)) !== null) {
			const body = match[1].trim();
			try {
				const obj = JSON.parse(body);
				if (obj?.tool || obj?.name) {
					const name = obj.tool || obj.name;
					let args = obj.arguments || obj.args || obj.parameters || obj;
					if (typeof args === 'string') {
						try { args = JSON.parse(args); } catch { }
					}
					if (args && typeof args === 'object') {
						if (!args.dirPath && args.path && ['list_directory', 'list_dir'].includes(name)) args.dirPath = args.path;
						if (!args.filePath && args.path && ['read_file', 'write_file', 'edit_file', 'delete_file'].includes(name)) args.filePath = args.path;
						if (!args.command && args.cmd && ['run_command', 'run_in_terminal'].includes(name)) args.command = args.cmd;
					}
					calls.push({ name, args });
					continue;
				}
			} catch { }

			const xmlCalls = this._parseXmlFunctionCalls(body);
			for (const xc of xmlCalls) {
				calls.push(xc);
			}
		}

		const actionRegex = /(?:Action|Tool):\s*([a-zA-Z0-9_\-]+)\s*(?:\r?\n)+(?:Action Input|Tool Input|Arguments|Input):\s*(\{[\s\S]*?\})/gi;
		let actionMatch: RegExpExecArray | null;
		while ((actionMatch = actionRegex.exec(text)) !== null) {
			const name = actionMatch[1].trim();
			try {
				const args = JSON.parse(actionMatch[2].trim());
				if (!calls.some(c => c.name === name && JSON.stringify(c.args) === JSON.stringify(args))) {
					calls.push({ name, args });
				}
			} catch {}
		}

		const directXmlCalls = this._parseXmlFunctionCalls(text);
		for (const xc of directXmlCalls) {
			if (!calls.some(c => c.name === xc.name && JSON.stringify(c.args) === JSON.stringify(xc.args))) {
				calls.push(xc);
			}
		}

		return calls;
	}

	private _parseXmlFunctionCalls(text: string): Array<{ name: string; args: any }> {
		const calls: Array<{ name: string; args: any }> = [];
		if (!text) return calls;

		const funcRegex = /<(?:function|function_call|tool|invoke)(?:[=\s]+(?:name=)?["']?([a-zA-Z0-9_\-\.]+)["']?|\s+[^>]*?name=["']([a-zA-Z0-9_\-\.]+)["'])[^>]*>([\s\S]*?)(?:<\/(?:function|function_call|tool|invoke)>|$)/gi;
		let match: RegExpExecArray | null;
		while ((match = funcRegex.exec(text)) !== null) {
			const name = match[1] || match[2];
			const body = match[3]?.trim() || '';
			if (!name) continue;

			const args: Record<string, any> = {};
			const paramRegex = /<(?:parameter|param|arg)\s+name=["']([a-zA-Z0-9_\-\.]+)["'][^>]*>([\s\S]*?)(?:<\/(?:parameter|param|arg)>|$)/gi;
			let paramMatch: RegExpExecArray | null;
			let foundParams = false;
			while ((paramMatch = paramRegex.exec(body)) !== null) {
				foundParams = true;
				const paramName = paramMatch[1];
				let paramVal: any = paramMatch[2].trim();
				if ((paramVal.startsWith('{') && paramVal.endsWith('}')) || (paramVal.startsWith('[') && paramVal.endsWith(']'))) {
					try { paramVal = JSON.parse(paramVal); } catch { }
				}
				args[paramName] = paramVal;
			}

			if (!foundParams && body) {
				try {
					const parsed = JSON.parse(body);
					if (typeof parsed === 'object' && parsed !== null) {
						Object.assign(args, parsed.arguments || parsed.args || parsed.parameters || parsed);
					}
				} catch {
					const normalizedName = name.toLowerCase();
					if (['run_command', 'run_in_terminal', 'bash', 'cmd', 'powershell', 'sh'].includes(normalizedName)) {
						args['command'] = body;
					} else if (['read_file', 'write_file', 'edit_file'].includes(normalizedName)) {
						args['filePath'] = body;
					} else if (['list_directory', 'list_dir'].includes(normalizedName)) {
						args['dirPath'] = body;
					}
				}
			}

			if (args && typeof args === 'object') {
				if (!args.dirPath && args.path && ['list_directory', 'list_dir'].includes(name)) args.dirPath = args.path;
				if (!args.filePath && args.path && ['read_file', 'write_file', 'edit_file', 'delete_file'].includes(name)) args.filePath = args.path;
				if (!args.command && args.cmd && ['run_command', 'run_in_terminal'].includes(name)) args.command = args.cmd;
			}

			calls.push({ name, args });
		}
		return calls;
	}

	private _extractResponseFromReasoning(reasoning: string): string {
		if (!reasoning || !reasoning.trim()) return '';
		const text = reasoning.trim();

		const match = text.match(/(?:(?:Final\s+Answer|Jawaban|Response|Kesimpulan|Output|Balasan|Reply)\s*:\s*)([\s\S]+)$/i);
		if (match && match[1].trim().length > 10) {
			return match[1].trim();
		}

		const quoteMatch = text.match(/(?:respond\s+with|jawab\s+dengan|balas\s+dengan)\s*:\s*["“]([\s\S]+?)["”]/i);
		if (quoteMatch && quoteMatch[1].trim().length > 10) {
			return quoteMatch[1].trim();
		}

		const cleaned = text
			.replace(/^(?:(?:Okay|So|Alright|Well),\s+the\s+user\s+(?:is\s+asking|wants)[\s\S]*?\n\n)/i, '')
			.replace(/^Thinking Process:[\s\S]*?\n\n/i, '')
			.trim();

		return cleaned || text;
	}

	private _extractFilePathFromApologyOrText(text: string): string | undefined {
		if (!text) return undefined;
		const backtickMatch = text.match(/`([a-zA-Z0-9_\-\.\/\\\~]+\.(?:php|blade\.php|json|jsx?|tsx?|css|scss|sass|html|py|go|rs|md|yaml|yml|toml|env|vue|svelte|sql|sh|bat|java|c|cpp|cs|rb|swift|kt|dart))`(?!\s*tiap)/i);
		if (backtickMatch && backtickMatch[1]) {
			const candidate = backtickMatch[1].trim();
			if (!candidate.includes('...') && !candidate.endsWith('.zip')) {
				return candidate;
			}
		}

		const quoteMatch = text.match(/["']([a-zA-Z0-9_\-\.\/\\\~]+\.(?:php|blade\.php|json|jsx?|tsx?|css|scss|sass|html|py|go|rs|md|yaml|yml|toml|env|vue|svelte|sql|sh|bat|java|c|cpp|cs|rb|swift|kt|dart))["']/i);
		if (quoteMatch && quoteMatch[1]) {
			const candidate = quoteMatch[1].trim();
			if (!candidate.includes('...') && !candidate.endsWith('.zip')) {
				return candidate;
			}
		}

		const keywordMatch = text.match(/(?:tempelkan|kirimkan|paste|send|baca|cek|periksa|read|inspect|file|berkas|path|route)\s+(?:isi\s+|output\s+|kode\s+)?([a-zA-Z0-9_\-\.\/\\\~]+\.(?:php|blade\.php|json|jsx?|tsx?|css|scss|sass|html|py|go|rs|md|yaml|yml|toml|env|vue|svelte|sql|sh|bat|java|c|cpp|cs|rb|swift|kt|dart))/i);
		if (keywordMatch && keywordMatch[1]) {
			const candidate = keywordMatch[1].trim();
			if (!candidate.includes('...') && !candidate.endsWith('.zip')) {
				return candidate;
			}
		}

		const wellKnownMatch = text.match(/\b((?:routes\/[a-zA-Z0-9_\-\/]+\.php)|(?:app\/[a-zA-Z0-9_\-\/]+\.php)|(?:resources\/views\/[a-zA-Z0-9_\-\/]+\.(?:blade\.php|php))|(?:database\/[a-zA-Z0-9_\-\/]+\.php)|(?:src\/[a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9]+)|(?:composer\.json)|(?:package\.json)|(?:artisan))\b/i);
		if (wellKnownMatch && wellKnownMatch[1]) {
			return wellKnownMatch[1].trim();
		}

		return undefined;
	}

	private _shouldAgentContinueAutonomousLoop(userPrompt: string, assistantText: string, turn: number): boolean {
		const p = userPrompt.toLowerCase().trim();
		const isExplicitGreeting = /^(halo|hai|hi|hello|siapa anda|who are you|apa kabar|terima kasih|thanks|thank you)\b/i.test(p);
		if (isExplicitGreeting && !/(buat|create|bikin|ubah|edit|fix|lanjut|continue|update|run|install|hapus|delete)/i.test(p)) {
			return false;
		}

		const isContinuationOrTask = /(lanjutkan|continue|teruskan|next|gas|go on|buat|create|bikin|ubah|edit|fix|selesaikan|implement|kerjakan|tambahkan|add)/i.test(p);
		const assistantPromisedAction = /(saya akan|mari kita|langkah selanjutnya|sekarang saya|berikutnya|i will|let's create|next step|next, i|i'll now)/i.test(assistantText);

		return isContinuationOrTask || assistantPromisedAction || turn > 1;
	}

	async resolveDynamicSkills(request: IChatAgentRequest, fileService: IFileService, customizationHarnessService?: ICustomizationHarnessService): Promise<IDynamicSkillInstruction[]> {
		const resolvedSkills = new Map<string, IDynamicSkillInstruction>();

		if (request.variables?.variables && Array.isArray(request.variables.variables)) {
			for (const variable of request.variables.variables) {
				const varAny = variable as any;
				if (varAny?.kind === 'promptFile' || varAny?.kind === 'instruction') {
					const uri: URI | undefined = URI.isUri(varAny.value) ? varAny.value : undefined;
					if (uri) {
						try {
							let rawText: string | undefined;
							if (isBuiltinSkillUri(uri)) {
								rawText = getBuiltinSkillContent(uri);
							} else {
								const fileData = await fileService.readFile(uri);
								rawText = fileData.value.toString();
							}
							if (rawText) {
								const defaultName = basename(uri).toLowerCase() === 'skill.md'
									? basename(dirname(uri))
									: (varAny.name || basename(uri).replace(/\.md$/, ''));
								const parsed = parseDynamicSkillMarkdown(rawText, defaultName);
								if (parsed.name && !resolvedSkills.has(parsed.name.toLowerCase())) {
									resolvedSkills.set(parsed.name.toLowerCase(), parsed);
								}
							}
						} catch (err) {
							console.warn(`[ChatAgentService] Could not read skill file from ${uri.toString()}:`, err);
						}
					}
				}
			}
		}

		const msg = typeof request.message === 'string' ? request.message : (request.message as any)?.text || '';
		if (msg.includes('/')) {
			const slashMatches = msg.match(/(?:^|\s)\/([\p{L}0-9_.:-]+)(?=\s|$)/gu);
			if (slashMatches && customizationHarnessService) {
				for (const match of slashMatches) {
					const tokenName = match.trim().replace(/^\//, '');
					if (!tokenName || resolvedSkills.has(tokenName.toLowerCase())) {
						continue;
					}
					try {
						const resolved = await customizationHarnessService.resolvePromptSlashCommand(tokenName, request.sessionResource, CancellationToken.None);
						if (resolved?.uri) {
							let rawText: string | undefined;
							if (isBuiltinSkillUri(resolved.uri)) {
								rawText = getBuiltinSkillContent(resolved.uri);
							} else {
								const fileData = await fileService.readFile(resolved.uri);
								rawText = fileData.value.toString();
							}
							if (rawText) {
								const defaultName = basename(resolved.uri).toLowerCase() === 'skill.md'
									? basename(dirname(resolved.uri))
									: resolved.name;
								const parsed = parseDynamicSkillMarkdown(rawText, defaultName);
								if (parsed.name && !resolvedSkills.has(parsed.name.toLowerCase())) {
									resolvedSkills.set(parsed.name.toLowerCase(), parsed);
								}
							}
						}
					} catch {
					}
				}
			}
		}

		return Array.from(resolvedSkills.values());
	}

	async streamDardcorRouter(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		let modelName = request.userSelectedModelId;
		let routerModelCapabilities: IDardcorRouterModelCapabilities = {};
		if (!modelName || modelName === 'auto' || modelName.endsWith('/auto') || modelName.endsWith('/no-model-selected')) {
			try {
				this.instantiationService.invokeFunction(accessor => {
					const chatService = accessor.get(IChatService);
					const sessionModel = chatService.getSession(request.sessionResource);
					const lastRequestWithModel = sessionModel?.getRequests().slice().reverse().find(r => r.modelId && r.modelId !== 'auto' && !r.modelId.endsWith('/auto') && !r.modelId.endsWith('/no-model-selected'));
					if (lastRequestWithModel?.modelId) {
						modelName = lastRequestWithModel.modelId;
					}
				});
			} catch { }
			if (modelName === 'auto' || modelName?.endsWith('/auto') || modelName?.endsWith('/no-model-selected')) {
				modelName = undefined;
			}
		}

		let chatEditingService: IChatEditingService | undefined;
		let fileService: IFileService | undefined;
		let editorService: IEditorService | undefined;
		let pathService: IPathService | undefined;
		let commandService: ICommandService | undefined;
		let customizationHarnessService: ICustomizationHarnessService | undefined;
		let todoListService: IChatTodoListService | undefined;
		let runStateService: IChatAgentRunStateService | undefined;
		let runState: IChatAgentRunState | undefined;
		let checkpointPersisted = false;
		let taskIsTracked = false;
		let activeTaskPrompt = '';
		const rawRequestPrompt = typeof request.message === 'string' ? request.message : (request.message as any)?.text || String(request.message || '');
		let isPlanMode = request.command === 'plan' || (request as any)?.mode === 'plan' || /^\s*(?:\/|\[)plan(?:\]|\b)/i.test(rawRequestPrompt);
		let planOpenedInEditor = false;
		let browserVerificationOnly = false;
		let consecutiveToolFailures = 0;
		let autonomousRecoveryAttempts = 0;
		const MAX_AUTONOMOUS_RECOVERY_ATTEMPTS = 3;
		let acceptedTaskCompletion = false;
		let proposedCompletionSummary: string | undefined;
		let finalSynthesisTurnPending = false;
		let finalSynthesisCompleted = false;
		const successfulTaskActions = new Map<string, number>();
		const taskChangedFiles = new Set<string>();
		let taskConclusionEmitted = false;
		let taskConclusionSummaryEmitted = false;
		let turnEncounteredFatalModelError = false;
		let turnSuccessfulToolActions = 0;
		let turnFileMutations = 0;
		try {
			this.instantiationService.invokeFunction(accessor => {
				try { chatEditingService = accessor.get(IChatEditingService); } catch { }
				try { fileService = accessor.get(IFileService); } catch { }
				try { editorService = accessor.get(IEditorService); } catch { }
				try { commandService = accessor.get(ICommandService); } catch { }
				try { pathService = accessor.get(IPathService); } catch { }
				try { customizationHarnessService = accessor.get(ICustomizationHarnessService); } catch { }
				try { todoListService = accessor.get(IChatTodoListService); } catch { }
				try { runStateService = accessor.get(IChatAgentRunStateService); } catch { }
			});
		} catch { }

		const openPlanPreview = async (planUri: URI): Promise<void> => {
			if (planOpenedInEditor) {
				return;
			}
			let previewOpened = false;
			if (commandService) {
				try {
					await commandService.executeCommand('markdown.showPreview', planUri);
					previewOpened = true;
					planOpenedInEditor = true;
				} catch (err) {
					console.warn('[streamDardcorRouter] markdown.showPreview failed, fallback to openEditor:', err);
				}
			}
			if (!previewOpened && editorService) {
				try {
					await editorService.openEditor({
						resource: planUri,
						options: {
							pinned: true,
							preserveFocus: true
						}
					});
					planOpenedInEditor = true;
				} catch (err) {
					console.warn('[streamDardcorRouter] Failed to auto-open plan in center editor:', err);
				}
			}
		};

		const saveRunState = (patch: Partial<Omit<IChatAgentRunState, 'version' | 'updatedAt'>> = {}): void => {
			if (!runState || !runStateService) {
				return;
			}
			runState = updateChatAgentRunState(runState, patch);
			try {
				runStateService.setState(request.sessionResource, runState);
				checkpointPersisted = true;
			} catch (error) {
				checkpointPersisted = false;
				console.warn('[streamDardcorRouter] Could not persist agent checkpoint:', error);
			}
		};
		const completionBlocker = (args: any): string | undefined => {
			if (!taskIsTracked || !runState) {
				return undefined;
			}
			const policyBlocker = getDardcorCompletionBlocker({
				prompt: activeTaskPrompt,
				todos: todoListService?.getTodos(request.sessionResource) ?? [],
				state: runState,
				verificationSteps: typeof args?.verificationSteps === 'string' ? args.verificationSteps : undefined,
			});
			if (policyBlocker) {
				return policyBlocker;
			}
			let markerService: IMarkerService | undefined;
			try {
				this.instantiationService.invokeFunction(accessor => markerService = accessor.get(IMarkerService));
			} catch { }
			const errorCount = markerService?.read({}).filter(marker => marker.severity === MarkerSeverity.Error).length ?? 0;
			return errorCount > 0 ? `Workspace diagnostics still contain ${errorCount} error(s). Fix and verify them before completion.` : undefined;
		};
		const recordToolEvidence = (toolName: string, args: any, output: string, externalEdit?: { uri: URI; editKind: 'create' | 'edit' | 'delete' }, executionStatus?: AgentToolExecutionStatus): void => {
			if (!taskIsTracked || !runState) {
				return;
			}
			const fileMutation = ['write_file', 'edit_file', 'delete_file', 'rename_file'].includes(toolName);
			const commandTool = ['run_command', 'run_in_terminal', 'create_and_run_task', 'run_task', 'send_to_terminal', 'kill_terminal', 'bash', 'execute_command', 'cmd', 'sh', 'powershell', 'terminal'].includes(toolName);
			const command = String(args?.command ?? args?.commandLine ?? args?.text ?? args?.label ?? args?.taskLabel ?? '');
			const mutationNotDenied = executionStatus !== 'denied' && executionStatus !== 'rejected'
				&& !/(?:Agent action not run|approval was denied|Tool call rejected)/i.test(output);
			const workspaceMutation = mutationNotDenied && (fileMutation || (commandTool && !isDardcorLowRiskCommand(command)));
			const workspaceRevision = runState.workspaceRevision + (workspaceMutation ? 1 : 0);
			const evidence = [...runState.verificationEvidence];
			const addEvidence = (message: string): void => {
				evidence.push({ message, workspaceRevision });
			};
			let verificationFailures = [...runState.verificationFailures];
			let verificationPending = [...runState.verificationPending];
			let browserActions = runState.browserActions;
			const exitCode = parseAgentCommandExitCode(output);
			const noBrowserChange = isDardcorBrowserTest(activeTaskPrompt) && /one Playwright click was sent\. Post-action evidence: no observable page or interactive-control change/i.test(output);
			const statusFailure = executionStatus !== undefined && ['failed', 'denied', 'timedOut', 'rejected'].includes(executionStatus);
			const failed = statusFailure || (exitCode !== undefined && exitCode !== 0) || noBrowserChange || /(?:Tool call rejected|Completion request rejected|Unknown tool|Browser Agent Error|No active browser tab|Could not open integrated browser|not tracked by Playwright|Agent action not run|approval was denied|Command failed|Command timed out|Terminal execution error|execution failed|cancelled while running|\b(?:command|tool|action|execution|verification|task|browser)\b.{0,50}\b(?:failed|failure|timed out|error)\b|\bfailed\s+(?:to|with|while|during)\b|\btimed out\b|\[ERROR\]|(?:^|\n)\s*(?:Error|Failed)(?::|\s+to\b)|❌|⚠️)/i.test(output);
			if (!failed && executionStatus !== 'unknown' && executionStatus !== 'running' && !['task_completed', 'complete_task', 'manage_todo_list', 'review_plan', 'ask_questions'].includes(toolName)) {
				const browserTool = ['open_browser_page', 'read_browser_page', 'read_page', 'navigate_browser', 'navigate_page', 'click_element', 'type_in_page', 'scroll_browser_page', 'hover_element', 'press_key', 'select_option', 'drag_and_drop', 'wait_for_browser', 'execute_browser_script', 'get_browser_console_logs', 'handle_browser_dialog', 'screenshot_browser_page', 'screenshot_page'].includes(toolName);
				const inspectionTool = ['read_file', 'list_directory', 'find_files', 'search_code', 'grep_search', 'get_diagnostics', 'get_file_outline', 'get_terminal_output', 'read_browser_page', 'read_page', 'get_browser_console_logs', 'screenshot_browser_page', 'screenshot_page'].includes(toolName);
				const actionLabel = browserTool ? 'Browser interactions' : fileMutation ? 'File changes' : commandTool ? 'Terminal commands' : inspectionTool ? 'Project inspections' : 'Agent actions';
				successfulTaskActions.set(actionLabel, (successfulTaskActions.get(actionLabel) ?? 0) + 1);
				if (fileMutation && externalEdit) {
					taskChangedFiles.add(externalEdit.uri.fsPath);
					turnFileMutations++;
				}
				turnSuccessfulToolActions++;
				if (fileMutation) {
					let markerService: IMarkerService | undefined;
					try {
						this.instantiationService.invokeFunction(accessor => {
							try { markerService = accessor.get(IMarkerService); } catch { }
						});
					} catch { }
					const errorCount = markerService?.read({}).filter(m => m.severity === MarkerSeverity.Error).length ?? 0;
					if (errorCount === 0) {
						const targetLabel = String(args?.filePath ?? externalEdit?.uri.fsPath ?? 'workspace').split(/[\\/]/).pop() || 'file';
						addEvidence(`Verified file mutation (${toolName}: ${targetLabel}) succeeded with 0 workspace diagnostic errors.`);
					}
				} else if (inspectionTool && toolName !== 'get_diagnostics') {
					addEvidence(`Workspace inspection (${toolName}) verified current project state.`);
				}
			}
			const diagnosticTarget = String(args?.filePath ?? 'workspace');
			if (!failed && toolName === 'get_diagnostics' && /No diagnostic problems/i.test(output)) {
				addEvidence('Workspace diagnostics reported no errors or warnings.');
				verificationFailures = verificationFailures.filter(item => !item.startsWith(`Workspace diagnostics (${diagnosticTarget}):`));
			} else if (toolName === 'get_diagnostics' && /\[(?:ERROR|WARNING)\]/i.test(output)) {
				verificationFailures = verificationFailures.filter(item => !item.startsWith(`Workspace diagnostics (${diagnosticTarget}):`));
				verificationFailures.push(`Workspace diagnostics (${diagnosticTarget}): ${output.split('\n').filter(line => /\[(?:ERROR|WARNING)\]/i.test(line)).slice(0, 5).join(' ')}`);
			}
			if (['run_command', 'run_in_terminal', 'create_and_run_task', 'run_task', 'get_task_output'].includes(toolName)) {
				const verificationStatus = getDardcorVerificationCommandStatus(command, output);
				const verificationLabel = formatDardcorVerificationLabel(command);
				if (verificationLabel) {
					if (verificationStatus === 'passed' && !failed) {
						addEvidence(`Verification check passed: ${verificationLabel}`);
						verificationFailures = verificationFailures.filter(item => !item.includes(verificationLabel));
						verificationPending = verificationPending.filter(item => !item.includes(verificationLabel));
					} else if (verificationStatus === 'failed' || (verificationStatus === 'passed' && failed)) {
						verificationFailures = verificationFailures.filter(item => !item.includes(verificationLabel));
						verificationPending = verificationPending.filter(item => !item.includes(verificationLabel));
						verificationFailures.push(`Verification check failed: ${verificationLabel}`);
					} else if (verificationStatus === 'inconclusive') {
						verificationPending = verificationPending.filter(item => !item.includes(verificationLabel));
						verificationPending.push(`Verification awaiting confirmation: ${verificationLabel}`);
					}
				}
			}
			const browserTool = ['open_browser_page', 'read_browser_page', 'read_page', 'navigate_browser', 'navigate_page', 'click_element', 'type_in_page', 'scroll_browser_page', 'hover_element', 'press_key', 'select_option', 'drag_and_drop', 'wait_for_browser', 'execute_browser_script', 'get_browser_console_logs', 'handle_browser_dialog', 'screenshot_browser_page', 'screenshot_page'].includes(toolName);
			const browserAction = ['click_element', 'type_in_page', 'scroll_browser_page', 'hover_element', 'press_key', 'select_option', 'drag_and_drop'].includes(toolName);
			const cleanBrowserConsole = /No console errors or warnings recorded/i.test(output);
			const browserDiagnosticText = toolName === 'get_browser_console_logs'
				? output
				: output.split('#### Browser Console & Runtime Diagnostics')[1] ?? '';
			const browserHasErrors = !cleanBrowserConsole && /(?:Console capture error|\b(?:uncaught|exception|rejected|failed|error)\b|(?:Type|Reference|Syntax)Error:)/i.test(browserDiagnosticText);
			const browserSnapshotHasContent = /#### Page Headings|#### Visible Page Text Content|^\[\d+\] </im.test(output)
				&& !/^\s*-\s*\*\*URL\*\*:\s*about:blank\b/im.test(output);
			const browserPageInspection = ['open_browser_page', 'read_browser_page', 'read_page', 'navigate_browser', 'navigate_page', 'screenshot_browser_page', 'screenshot_page'].includes(toolName)
				&& !failed
				&& !browserHasErrors
				&& browserSnapshotHasContent
				&& output.includes('### Active Browser Page Snapshot');
			const approvalBlocked = /Agent action not run|approval was denied/i.test(output);
			const browserOperationFailed = browserTool && !approvalBlocked && (failed || browserHasErrors);
			const pageUrl = output.match(/\*\*URL\*\*:\s*([^\s\r\n]+)|Diagnostics\s+\(([^)\s]+)/i);
			const browserFailurePrefix = `Browser runtime (${pageUrl?.[1] ?? pageUrl?.[2] ?? 'current page'}):`;
			if (toolName === 'get_browser_console_logs' && cleanBrowserConsole) {
				addEvidence('Integrated browser console inspection found no errors or warnings.');
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserFailurePrefix));
			} else if (toolName === 'get_browser_console_logs' && browserHasErrors) {
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserFailurePrefix));
				verificationFailures.push(`${browserFailurePrefix} ${browserDiagnosticText.trim().slice(0, 350)}`);
			}
			if (browserTool && browserHasErrors) {
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserFailurePrefix));
				verificationFailures.push(`${browserFailurePrefix} ${browserDiagnosticText.trim().slice(0, 350)}`);
			}
			if (browserPageInspection) {
				const inspectedUrl = output.match(/\*\*URL\*\*:\s*([^\s\r\n]+)/)?.[1] ?? 'active page';
				addEvidence(`Integrated browser page inspected: ${inspectedUrl} with a rendered DOM snapshot and browser diagnostics.`);
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserFailurePrefix));
			}
			if (browserAction && browserHasErrors) {
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserFailurePrefix));
				verificationFailures.push(`${browserFailurePrefix} ${browserDiagnosticText.trim().slice(0, 350)}`);
			} else if (browserAction && toolName === 'click_element' && noBrowserChange) {
				const actionFailurePrefix = `Browser action (${pageUrl?.[1] ?? pageUrl?.[2] ?? 'current page'}):`;
				verificationFailures = verificationFailures.filter(item => !item.startsWith(actionFailurePrefix));
				verificationFailures.push(`${actionFailurePrefix} one click was sent, but the post-action snapshot showed no observable URL, title, or visible text change.`);
			} else if (browserAction && !failed && output.includes('### Active Browser Page Snapshot') && (/\b(?:Clicked|Typed|Scrolled|Hovered|Pressed|Selected|Dragged|Wait condition met|Configured browser|Captured live)\b/i.test(output) || /✅/.test(output))) {
				browserActions++;
				addEvidence(`Integrated browser ${toolName} succeeded and returned a post-action DOM snapshot.`);
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserFailurePrefix));
				if (toolName === 'click_element') {
					const actionFailurePrefix = `Browser action (${pageUrl?.[1] ?? pageUrl?.[2] ?? 'current page'}):`;
					verificationFailures = verificationFailures.filter(item => !item.startsWith(actionFailurePrefix));
				}
			}
			if (browserOperationFailed && !browserHasErrors) {
				const browserActionFailurePrefix = `Integrated browser (${toolName}):`;
				verificationFailures = verificationFailures.filter(item => !item.startsWith(browserActionFailurePrefix));
				verificationFailures.push(`${browserActionFailurePrefix} ${output.replace(/[\r\n\t]+/g, ' ').slice(0, 350)}`);
			}
			const dedupedEvidence = [...new Map(evidence.map(item => [`${item.workspaceRevision}:${item.message}`, item])).values()];
			const incompleteTodo = todoListService?.getTodos(request.sessionResource).find(todo => todo.status !== 'completed');
			const nextStep = approvalBlocked
				? 'The requested action was not run because approval was denied. Wait for a new user decision before retrying it.'
				: browserOperationFailed
				? /(?:service accessor is only valid|not tracked by Playwright|could not be registered|page .* closed|did not become ready|no active browser tab|browser editor.*unavailable)/i.test(output)
					? 'Restore the integrated Browser Editor/Playwright page attachment, then retry the requested browser action and inspect its post-action snapshot. Do not substitute HTTP or terminal output for interaction evidence.'
					: 'Use the returned browser error and current DOM snapshot to correct the target or action arguments, then retry the browser action and inspect its post-action snapshot.'
				: failed
				? 'Inspect and resolve the latest failed tool action before retrying or continuing.'
				: executionStatus === 'unknown' || executionStatus === 'running'
					? 'Poll the task or inspect its terminal output until a final exit status is available; do not treat the current output as verification.'
				: incompleteTodo
					? `Continue the first incomplete checklist item: ${incompleteTodo.title.slice(0, 300)}`
					: 'Run the task-specific verification and inspect its actual result before requesting completion.';
			const verificationAction = toolName === 'get_diagnostics'
				|| (['run_command', 'run_in_terminal', 'create_and_run_task', 'run_task', 'get_task_output'].includes(toolName)
					&& getDardcorVerificationCommandStatus(String(args?.command ?? args?.commandLine ?? args?.label ?? args?.taskLabel ?? ''), output) !== 'not-verification')
				|| browserAction;
			saveRunState({
				status: approvalBlocked ? 'blocked' : verificationAction ? 'verifying' : 'working',
				verificationEvidence: dedupedEvidence,
				workspaceRevision,
				verificationFailures: [...new Set(verificationFailures)],
				verificationPending: [...new Set(verificationPending)],
				browserActions,
				lastError: failed ? output.slice(0, 500) : undefined,
				nextStep,
			});
			if (browserVerificationOnly && runState) {
				browserVerificationOnly = !!getDardcorBrowserVerificationRequirement(activeTaskPrompt, runState);
			}
		};
		const emitTaskConclusion = (): void => {
			let todos = [] as ReturnType<IChatTodoListService['getTodos']>;
			try {
				todos = todoListService?.getTodos(request.sessionResource) ?? [];
			} catch {}
			if ((!taskIsTracked && todos.length === 0) || taskConclusionEmitted) {
				return;
			}
			taskConclusionEmitted = true;
			const status = runState?.status ?? 'blocked';
			if (status === 'completed' && acceptedTaskCompletion && finalSynthesisCompleted) {
				return;
			}
			const isComplete = status === 'completed' && acceptedTaskCompletion;
			const isCancelled = token.isCancellationRequested || status === 'cancelled';
			const isBlocked = status === 'blocked';
			const isPaused = !isComplete && !isCancelled && !isBlocked && status === 'paused';

			const completedTodos = todos.filter(todo => todo.status === 'completed').length;
			const pendingTodos = todos.filter(todo => todo.status !== 'completed');

			const allEvidence = runState?.verificationEvidence ?? [];
			const evidence = allEvidence.filter(item => item.workspaceRevision === runState?.workspaceRevision);
			const failures = runState?.verificationFailures ?? [];
			const pendingVerification = runState?.verificationPending ?? [];

			const lang = detectDardcorLanguage(activeTaskPrompt);
			const i18n = getDardcorLocaleStrings(lang);

			let workspaceFolders: string[] = [];
			try {
				this.instantiationService.invokeFunction(accessor => {
					const wsService = accessor.get(IWorkspaceContextService);
					workspaceFolders = wsService.getWorkspace().folders.map(f => f.uri.fsPath);
				});
			} catch { }

			const formatFilePath = (filePath: string): string => {
				for (const folder of workspaceFolders) {
					if (filePath.toLowerCase().startsWith(folder.toLowerCase())) {
						const rel = filePath.slice(folder.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
						return rel || filePath;
					}
				}
				const tempDir = (typeof process !== 'undefined' && (process.env.TEMP || process.env.TMP)) || '';
				if (tempDir && filePath.toLowerCase().startsWith(tempDir.toLowerCase())) {
					const base = filePath.slice(tempDir.length).replace(/^[\\/]+/, '');
					return `temp/${base}`;
				}
				return filePath.replace(/\\/g, '/');
			};

			const lines: string[] = [];
			const title = isComplete
				? i18n.taskSummaryComplete
				: isPaused
					? i18n.taskSummaryPaused
					: i18n.taskSummaryBlocked;

			if (!turnEncounteredFatalModelError) {
				lines.push(`\n\n### ${title}`);
			}

			if (isComplete && proposedCompletionSummary?.trim() && !taskConclusionSummaryEmitted) {
				lines.push('', proposedCompletionSummary.trim().slice(0, 1800));
			}

			if (taskChangedFiles.size > 0) {
				const fileList = [...taskChangedFiles].map(formatFilePath);
				lines.push('', `**${i18n.changedFiles} (${fileList.length}):** ${fileList.slice(0, 10).map(file => `\`${file}\``).join(', ')}${fileList.length > 10 ? `, +${fileList.length - 10} more` : ''}`);
			}

			if (todos.length > 0) {
				lines.push('', `**${i18n.checklist}:** ${completedTodos}/${todos.length} ${i18n.complete}`);
			}

			if (evidence.length > 0) {
				lines.push('', `**${i18n.verificationEvidence}:**`);
				for (const item of evidence.slice(-4)) {
					const cleanMsg = item.message.replace(/[\r\n\t]+/g, ' ').trim();
					lines.push(`- ${cleanMsg}`);
				}
			}



			if (pendingVerification.length > 0) {
				lines.push('', `**${i18n.verificationPending}:**`);
				for (const item of pendingVerification.slice(0, 3)) {
					const cleanMsg = item.replace(/[\r\n\t]+/g, ' ').trim();
					lines.push(`- ${cleanMsg}`);
				}
			}

			if (!isComplete) {
				const nextItem = pendingTodos[0]?.title ?? runState?.nextStep ?? i18n.resumeDefault;
				lines.push('', `**${i18n.nextStep}:** ${nextItem}`);

				const blocker = runState?.lastError?.replace(/[\r\n\t]+/g, ' ').trim();
				if (blocker && blocker !== runState?.nextStep && blocker !== nextItem && !turnEncounteredFatalModelError) {
					const cleanBlocker = cleanMessageText(blocker);
					lines.push(`**${i18n.reason}:** ${cleanBlocker}`);
				}
				const hasFatalModelOrRouterError = turnEncounteredFatalModelError || !!(
					blocker && /(?:Dardcor Router returned HTTP|forbidden_plan_required|model_not_supported|FreeUsageLimitError|quota exceeded|insufficient_credits|credits required|insufficient balance|payment required|unauthorized|pricingUrl|Requested entity was not found|Model not found|all \d+ accounts locked|Paid subscription or credits required|Connect Timeout Error|ERR_TIMED_OUT|ECONNREFUSED|ECONNRESET|fetch failed|stream reading error|did not complete after \d+ attempts)/i.test(blocker)
				);
				const shouldAutoResumeIncompleteTodos = !isComplete
					&& !token.isCancellationRequested
					&& !isCancelled
					&& !isBlocked
					&& !hasFatalModelOrRouterError
					&& pendingTodos.length > 0
					&& isFullAccessActive();
				if (hasFatalModelOrRouterError || isBlocked) {
					const diagnosis = diagnoseProviderIssue(0, blocker || runState?.lastError || '', modelName, lang);
					const badgeIcon = diagnosis.category === 'DOWN' ? '🔴' : diagnosis.category === 'LIMIT' ? '⏳' : '⚠️';
					const categoryName = diagnosis.category === 'DOWN'
						? (lang === 'id' ? 'SERVER PROVIDER DOWN' : 'PROVIDER SERVER DOWN')
						: diagnosis.category === 'LIMIT'
							? (lang === 'id' ? 'KUOTA LIMIT' : 'QUOTA LIMIT')
							: (lang === 'id' ? 'KENDALA PROVIDER' : 'PROVIDER ERROR');

					lines.push(
						'',
						`> ${badgeIcon} **[${categoryName}] ${diagnosis.provider} — ${diagnosis.model}**`,
						`> *${diagnosis.description}*`,
						'',
						`> 💡 ${lang === 'id'
							? 'Pilih model lain pada pemilih model di kanan bawah — tugas akan **otomatis dilanjutkan** seketika tanpa perlu mengetik continue.'
							: 'Select another model in the bottom-right model picker — the task will **auto-resume** immediately without manual typing.'}`
					);
				} else if (shouldAutoResumeIncompleteTodos) {
					lines.push('', `> **${i18n.autoContinueActive}**`);
				} else {
					lines.push('', `> 💡 ${lang === 'id' ? 'Tugas dijeda sementara. Pilih model lain untuk melanjutkan otomatis.' : 'Task paused. Select another model to auto-resume.'}`);
				}
			}

			progress([{ kind: 'markdownContent', content: new MarkdownString(`${lines.join('\n')}\n\n`) }]);

			if (shouldAutoResumeIncompleteTodos) {
				setTimeout(() => {
					try {
						this.instantiationService.invokeFunction(accessor => {
							const chatService = accessor.get(IChatService);
							chatService.sendRequest(request.sessionResource, 'continue', {
								userSelectedModelId: modelName ?? request.userSelectedModelId,
								modeInfo: request.modeInfo,
								agentIdSilent: request.agentId,
								location: request.location,
								locationData: request.locationData,
							});
						});
					} catch (err) {
						console.warn('[streamDardcorRouter] Auto-continue dispatch failed:', err);
					}
				}, 1200);
			}
		};
		const noteToolFailure = (output: string, executionStatus?: AgentToolExecutionStatus): boolean => {
			if (!taskIsTracked || token.isCancellationRequested) {
				return false;
			}
			if (executionStatus === 'unknown' || executionStatus === 'running') {
				return false;
			}
			if (/(?:Tool call rejected|Completion request rejected|Unknown tool|Browser Agent Error|No active browser tab|Could not open integrated browser|not tracked by Playwright|Agent action not run|approval was denied|one Playwright click was sent\. Post-action evidence: no observable page or interactive-control change|Command failed|Command timed out|did not report completion|without reporting an exit code|completion status not reported|not marked successful|Terminal execution error|execution failed|cancelled while running|\b(?:command|tool|action|execution|verification|task|browser)\b.{0,50}\b(?:failed|failure|timed out|error)\b|\bfailed\s+(?:to|with|while|during)\b|\btimed out\b|(?:^|\n)\s*(?:Error|Failed)(?::|\s+to\b)|❌|⚠️)/i.test(output)) {
				if (/Agent action not run|approval was denied/i.test(output)) {
					return true;
				}
				const failureState = getDardcorToolFailureState(consecutiveToolFailures, true);
				consecutiveToolFailures = failureState.consecutiveFailures;
				return failureState.shouldBlock;
			} else {
				consecutiveToolFailures = getDardcorToolFailureState(consecutiveToolFailures, false).consecutiveFailures;
			}
			return false;
		};
		const executeAgentToolCancellable = async (toolName: string, args: any, rootUri?: URI, approvedByUser = false, fileReadResolution?: IAgentFileReadResolution) => {
			const result = await raceCancellation(this._executeAgentTool(toolName, args, rootUri, request.sessionResource, token, request.requestId, approvedByUser, fileReadResolution), token);
			const resolved = result ?? { output: `Tool action ${toolName} was interrupted before its result was known; inspect terminal, browser, or workspace state before retrying it.` };
			if (resolved.browserImage && !shouldAttachDardcorBrowserScreenshot(routerModelCapabilities)) {
				resolved.output += '\n\nA screenshot was captured in the integrated browser, but it was not attached because Router metadata does not confirm vision support. The DOM and accessibility snapshot remain available.';
			}
			return resolved;
		};
		const approvedCommandKeys = new Set<string>();
		const getEffectiveRouterPermission = (): { permissionLevel: ChatPermissionLevel | undefined; fullAccessRestricted: boolean } => {
			let selectedPermissionLevel = request.permissionLevel;
			try {

				const sessionPermissionLevel = this.instantiationService.invokeFunction(accessor =>
					accessor.get(IChatService).getSession(request.sessionResource)?.inputModel.state.get()?.permissionLevel
				);
				if (sessionPermissionLevel !== undefined) {
					selectedPermissionLevel = sessionPermissionLevel;
				}
			} catch {}

			const fullAccessRestrictedByPolicy = this.configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove).policyValue === false;
			return {
				permissionLevel: getDardcorEffectivePermissionLevel(selectedPermissionLevel, fullAccessRestrictedByPolicy) as ChatPermissionLevel | undefined,
				fullAccessRestricted: fullAccessRestrictedByPolicy && selectedPermissionLevel === ChatPermissionLevel.AutoApprove,
			};
		};
		const isFullAccessActive = (): boolean => {
			const perm = getEffectiveRouterPermission();
			return isAutoApproveLevel(perm.permissionLevel);
		};
		const formatApprovalDetails = (details: string): string => {
			const longestBacktickRun = Math.max(0, ...Array.from(details.matchAll(/`+/g), match => match[0].length));
			const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
			return `${fence}text\n${details}\n${fence}`;
		};
		const waitForQuestionAnswers = async (
			toolCallId: string,
			rawQuestions: readonly any[],
			allowSkip: boolean,
		): Promise<{ answers?: IChatQuestionAnswers; error?: string }> => {
			if (rawQuestions.length === 0) {
				return { error: 'No valid questions were provided; no action was approved.' };
			}

			let chatService: IChatService;
			try {
				chatService = this.instantiationService.invokeFunction(accessor => accessor.get(IChatService));
			} catch (error) {
				return { error: `The chat input UI is unavailable: ${error instanceof Error ? error.message : String(error)}` };
			}

			const questions: IChatCarouselQuestion[] = rawQuestions.map((question, index) => {
				const options = Array.isArray(question?.options)
					? question.options.filter((option: any) => option && typeof option.label === 'string').map((option: any) => ({
						id: option.id ?? option.value ?? option.label,
						label: option.description ? `${option.label} - ${option.description}` : option.label,
						value: option.value ?? option.id ?? option.label,
					}))
					: [];
				const recommended = question?.options?.find((option: any) => option?.recommended)?.id
					?? question?.options?.find((option: any) => option?.recommended)?.value
					?? question?.options?.find((option: any) => option?.recommended)?.label;
				const fullQuestion = typeof question?.question === 'string' ? question.question : '';
				const moveLongQuestionToDetails = fullQuestion.length > 240 || /\r?\n/.test(fullQuestion);
				const questionMessage = moveLongQuestionToDetails
					? `${fullQuestion.slice(0, 180).trimEnd()}${fullQuestion.length > 180 ? '…' : ''}`
					: fullQuestion;
				const detailedParts = [
					moveLongQuestionToDetails ? fullQuestion : undefined,
					typeof question?.message === 'string' ? question.message : undefined,
				].filter((part): part is string => !!part?.trim());
				return {
					id: `${toolCallId}:${index}`,
					type: options.length === 0 ? 'text' : question?.multiSelect ? 'multiSelect' : 'singleSelect',
					title: typeof question?.header === 'string' && question.header.trim() ? question.header.trim() : `Question ${index + 1}`,
					message: questionMessage,
					detailedMessage: detailedParts.length > 0 ? detailedParts.join('\n\n') : undefined,
					options: options.length > 0 ? options : undefined,
					defaultValue: recommended,
					allowFreeformInput: question?.allowFreeformInput !== false,
					required: question?.required !== false,
				};
			});
			const carousel = new ChatQuestionCarouselData(questions, allowSkip, toolCallId);
			const answerListener = chatService.onDidReceiveQuestionCarouselAnswer(event => {
				if (event.resolveId === toolCallId && (!event.requestId || event.requestId === request.requestId)) {
					carousel.dismiss(event.answers);
				}
			});
			progress([carousel as any]);
			try {
				const result = await raceCancellation(carousel.completion.p, token);
				return result ? { answers: result.answers } : {};
			} finally {
				answerListener.dispose();
				carousel.dismiss(undefined);
			}
		};
		const formatQuestionAnswers = (rawQuestions: readonly any[], answers: IChatQuestionAnswers | undefined, toolCallId: string): string => {
			const formatted: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }> = {};
			for (let index = 0; index < rawQuestions.length; index++) {
				const question = rawQuestions[index];
				const header = typeof question?.header === 'string' && question.header.trim() ? question.header.trim() : `Question ${index + 1}`;
				const answer = answers?.[`${toolCallId}:${index}`];
				const selectedValue = typeof answer === 'string'
					? (Array.isArray(question?.options) && question.options.length > 0 ? [answer] : [])
					: Array.isArray((answer as any)?.selectedValues)
						? (answer as any).selectedValues.filter((value: unknown): value is string => typeof value === 'string')
						: typeof (answer as any)?.selectedValue === 'string' ? [(answer as any).selectedValue] : [];
				const freeText = typeof answer === 'string' && (!question?.options || question.options.length === 0)
					? answer
					: typeof (answer as any)?.freeformValue === 'string' ? (answer as any).freeformValue : null;
				formatted[header] = { selected: selectedValue, freeText, skipped: answer === undefined };
			}
			return JSON.stringify({ answers: formatted });
		};
		const routerDynamicToolByName = new Map<string, IToolData>();
		let routerToolDefinitions: readonly DardcorRouterToolDefinition[] = DARDCOR_AGENT_TOOLS as readonly DardcorRouterToolDefinition[];
		const routerToolRuntime = new DardcorAgentToolRuntime();
		const executeRouterTool = async (toolName: string, args: any, rootUri: URI | undefined, toolCallId: string) => {
			if (isPlanMode && ['edit_file', 'delete_file', 'rename_file'].includes(toolName)) {
				return { output: `Tool rejected: In Plan Mode, you must not edit or delete workspace files. Focus on researching and formulating the implementation plan.` };
			}
			if (isPlanMode && toolName === 'write_file') {
				const targetPath = extractAgentFilePath(args);
				const isMemoryPlan = targetPath && (targetPath.includes('.dardcor/memory/plans') || targetPath.includes('.dardcor\\memory\\plans') || targetPath.endsWith('.md'));
				if (!isMemoryPlan) {
					return { output: `Tool rejected: In Plan Mode, you must not write code files to the project. Formulate your implementation plan and call review_plan or present it in your response.` };
				}
			}
			if (browserVerificationOnly && !DARDCOR_BROWSER_VERIFICATION_TOOL_NAMES.has(toolName)) {
				return { output: `Tool call rejected: browser verification is the only enabled action until the integrated Browser Editor returns the required live page evidence. Retry with a browser inspection or interaction tool.` };
			}
			if (toolName === 'ask_questions') {
				const questions = Array.isArray(args?.questions) ? args.questions.filter((question: any) => question && typeof question === 'object') : [];
				const result = await waitForQuestionAnswers(toolCallId, questions, true);
				return { output: result.error ?? formatQuestionAnswers(questions, result.answers, toolCallId) };
			}
			if (toolName === 'review_plan') {
				const actions = Array.isArray(args?.actions) && args.actions.length > 0
					? args.actions.filter((action: any) => action && typeof action.label === 'string')
					: [{ label: 'Approve plan', default: true }];
				if (actions.length === 0) {
					return { output: JSON.stringify({ rejected: true, feedback: 'The plan had no valid review actions.' }) };
				}
				let planUri: URI | undefined;
				try {
					if (fileService && pathService) {
						const userHome = await pathService.userHome();
						const memoryDir = joinPath(userHome, '.dardcor', 'memory', 'plans');
						if (!await fileService.exists(memoryDir)) {
							await fileService.createFolder(memoryDir);
						}
						const slug = (args?.title || 'implementation-plan').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '') || 'plan';
						const planFileName = `${slug}-${Date.now().toString(36)}.md`;
						planUri = joinPath(memoryDir, planFileName);
						const planHeader = `# ${args?.title || 'Implementation Plan'}\n\n`;
						const fullContent = (args?.content || '').startsWith('#') ? (args?.content || '') : `${planHeader}${args?.content || ''}`;
						await fileService.writeFile(planUri, VSBuffer.fromString(fullContent));
					}
				} catch (err) {
					console.warn('[streamDardcorRouter] Failed to write plan to memory store:', err);
				}

				const review = new ChatPlanReviewData(args?.title || 'Implementation Plan', args?.content || '', actions, args?.canProvideFeedback !== false, planUri, toolCallId);
				progress([review as any]);

				if (planUri) {
					openPlanPreview(planUri).catch(err => {
						console.warn('[streamDardcorRouter] Failed to auto-open plan preview in center editor:', err);
					});
				}
				try {
					const result = await raceCancellation(review.completion.p, token);
					if (result && !result.rejected) {
						isPlanMode = false;
						taskIsTracked = true;
						const planTitle = args?.title || 'Implementation Plan';
						const extractedTodos = extractTodosFromPlan(args?.content || '', planTitle);
						if (extractedTodos.length > 0 && todoListService && request.sessionResource) {
							try {
								todoListService.setTodos(request.sessionResource, extractedTodos as any);
							} catch (e) {
								console.warn('[review_plan] Failed to set extracted plan todos:', e);
							}
						}
						if (!runState) {
							runState = createChatAgentRunState('working');
						}
						saveRunState({
							status: 'working',
							stalledTurns: 0,
							lastError: undefined,
							taskPrompt: `Implement approved plan: ${planTitle}`,
							nextStep: extractedTodos.length > 0 ? `Start working on: ${extractedTodos[0].title}` : 'Implement approved tasks'
						});
						return {
							output: `[Plan Approved by User - Autonomous Execution Authorized]: The user has approved the implementation plan "${planTitle}". Planning mode is now COMPLETE. All modification tools (write_file, edit_file, delete_file, run_command) are now fully enabled. Proceed immediately to implement the required project files step-by-step according to the approved plan without stopping until 100% completed.`
						};
					}
					return { output: JSON.stringify(result ?? { rejected: true, feedback: 'The review was cancelled or dismissed; no approval was recorded.' }) };
				} finally {
					review.dismiss();
				}
			}
			if (toolName === 'confirm_terminal_command') {
				const command = String(args?.command ?? args?.commandLine ?? '').trim();
				if (!command) {
					return { output: 'Command confirmation rejected: a command string is required.' };
				}
				const permission = getEffectiveRouterPermission();
				if (permission.permissionLevel === ChatPermissionLevel.AutoApprove) {
					approvedCommandKeys.add(commandApprovalKey(command, rootUri?.toString()));
					return { output: JSON.stringify({ approved: true, command, scope: 'session full access' }) };
				}
				const promptForLang = activeTaskPrompt || (typeof request.message === 'string' ? request.message : (request.message as any)?.text || '');
				const userLang = detectDardcorLanguage(promptForLang);
				const locale = getDardcorLocaleStrings(userLang);
				const policyNote = permission.fullAccessRestricted ? locale.confirmPolicyRestricted : '';
				const result = await waitForQuestionAnswers(toolCallId, [{
					header: locale.confirmTerminalHeader,
					question: `${policyNote}${locale.confirmExactCommandQuestion}`,
					message: formatApprovalDetails(`${args?.explanation ? `${args.explanation}\n\n` : ''}${command}`),
					options: [
						{ id: 'skip', value: 'skip', label: locale.confirmSkipCommand, recommended: true },
						{ id: 'allow_once', value: 'allow_once', label: locale.confirmAllowOnce }
					],
					allowFreeformInput: false,
					required: true,
				}], false);
				const answer = result.answers?.[`${toolCallId}:0`] as any;
				const selected = typeof answer === 'string' ? answer : (answer?.selectedValue ?? answer?.value ?? answer?.id);
				const approved = typeof selected === 'string'
					&& (selected.toLowerCase() === 'allow_once' || selected.toLowerCase() === 'allow' || selected === 'Allow once' || selected === locale.confirmAllowOnce);
				if (approved) {
					approvedCommandKeys.add(commandApprovalKey(command, rootUri?.toString()));
				}
				return { output: result.error ?? JSON.stringify({ approved, command, scope: 'one-time exact command' }) };
			}

			const isCommandTool = ['run_command', 'run_in_terminal', 'bash', 'execute_command', 'cmd', 'sh', 'powershell', 'terminal', 'create_and_run_task', 'run_task', 'send_to_terminal', 'kill_terminal'].includes(toolName)
				|| /terminal|command|runin/i.test(toolName);
			const permission = getEffectiveRouterPermission();
			const permissionLevel = permission.permissionLevel;
			let approvedByUser = false;
			if (isCommandTool) {
				const command = toolName === 'kill_terminal'
					? `kill_terminal:${String(args?.id ?? args?.terminalId ?? '').trim()}`
					: String(args?.command ?? args?.commandLine ?? args?.taskLabel ?? args?.label ?? args?.text ?? '').trim();
				const key = commandApprovalKey(command, rootUri?.toString());
				approvedByUser = approvedCommandKeys.delete(key);
			}
			const isFileReadTool = ['read', 'view_file', 'read_file'].includes(toolName);
			const fileReadResolution = isFileReadTool
				? await resolveAgentFileReadTarget(fileService, extractAgentFilePath(args), rootUri)
				: undefined;
			const externalFileReadRequiresApproval = fileReadResolution?.requiresApproval ?? false;
			const permissionRequired = requiresDardcorToolConfirmation(toolName, args, permissionLevel, externalFileReadRequiresApproval);
			if (permissionRequired && !approvedByUser) {
				const command = isCommandTool
					? (toolName === 'kill_terminal'
						? `kill_terminal:${String(args?.id ?? args?.terminalId ?? '').trim()}`
						: String(args?.command ?? args?.commandLine ?? args?.taskLabel ?? args?.label ?? args?.text ?? '').trim())
					: '';
				const isTerminalConfirmation = isCommandTool;
				const promptForLang = activeTaskPrompt || (typeof request.message === 'string' ? request.message : (request.message as any)?.text || '');
				const userLang = detectDardcorLanguage(promptForLang);
				const locale = getDardcorLocaleStrings(userLang);
				const summary = isTerminalConfirmation && command
					? command.replace(/[\r\n\t]+/g, ' ').slice(0, 400)
					: summarizeDardcorToolAction(toolName, args, userLang);
				const header = isTerminalConfirmation ? locale.confirmTerminalHeader : locale.confirmAgentActionHeader;
				const policyPrefix = permission.fullAccessRestricted ? locale.confirmPolicyRestricted : '';
				const questionBody = externalFileReadRequiresApproval
					? locale.confirmExternalFile
					: (isTerminalConfirmation ? locale.confirmTerminalActionQuestion : locale.confirmAgentActionQuestion);
				const skipLabel = isTerminalConfirmation ? locale.confirmSkipCommand : locale.confirmSkipAction;
				const allowLabel = locale.confirmAllowOnce;

				const result = await waitForQuestionAnswers(toolCallId, [{
					header,
					question: `${policyPrefix}${questionBody}`,
					message: formatApprovalDetails(summary),
					options: [
						{ id: 'skip', value: 'skip', label: skipLabel, recommended: true },
						{ id: 'allow_once', value: 'allow_once', label: allowLabel }
					],
					allowFreeformInput: false,
					required: true,
				}], false);
				const answer = result.answers?.[`${toolCallId}:0`] as any;
				const selected = typeof answer === 'string' ? answer : (answer?.selectedValue ?? answer?.value ?? answer?.id);
				const approved = typeof selected === 'string'
					&& (selected.toLowerCase() === 'allow_once' || selected.toLowerCase() === 'allow' || selected === 'Allow once' || selected === allowLabel);
				if (result.error || !approved) {
					return { output: result.error
						? `Agent action not run: ${result.error}`
						: `Agent action not run because approval was denied: ${summary}` };
				}
				approvedByUser = true;
			} else if (!permissionRequired) {

				approvedByUser = true;
			}
			const dynamicTool = routerDynamicToolByName.get(toolName);
			if (dynamicTool) {
				return this._invokeBuiltinAgentTool(dynamicTool.id, args, request.sessionResource, rootUri, request.requestId, token, approvedByUser);
			}
			return executeAgentToolCancellable(toolName, args, rootUri, approvedByUser, fileReadResolution);
		};

		try {
			const activeSkills = fileService ? await this.resolveDynamicSkills(request, fileService, customizationHarnessService) : [];

			const snapshot = await this.getWorkspaceSnapshot();
			const dynamicRouterToolDefinitions: DardcorRouterToolDefinition[] = [];
			const unavailableDynamicTools: string[] = [];
			try {
				const localTools = this.instantiationService.invokeFunction(accessor => Array.from(accessor.get(ILanguageModelToolsService).getTools(undefined)));
				const knownNames = new Set(DARDCOR_AGENT_TOOLS.map(tool => tool.function.name));
				for (const tool of localTools) {
					const toolName = createRouterLocalToolName(tool);
					if (!tool.inputSchema || knownNames.has(toolName)) {
						unavailableDynamicTools.push(tool.toolReferenceName || tool.id);
						continue;
					}
					try {
						const inputSchema = JSON.parse(JSON.stringify(tool.inputSchema)) as Record<string, unknown>;
						if (!inputSchema.type) {
							inputSchema.type = 'object';
						}
						const description = (tool.modelDescription || tool.userDescription || `Invoke local tool ${tool.displayName}`).slice(0, 2400);
						dynamicRouterToolDefinitions.push({ type: 'function', function: { name: toolName, description, parameters: inputSchema } });
						routerDynamicToolByName.set(toolName, tool);
						knownNames.add(toolName);
					} catch {
						unavailableDynamicTools.push(tool.toolReferenceName || tool.id);
					}
				}
			} catch (error) {
				console.warn('[streamDardcorRouter] Could not enumerate local language model tools:', error);
			}
			routerToolDefinitions = [
				...(DARDCOR_AGENT_TOOLS as readonly DardcorRouterToolDefinition[]),
				...dynamicRouterToolDefinitions,
			];
			const commandToolNames = new Set(['run_command', 'run_in_terminal', 'run_task', 'create_and_run_task', 'send_to_terminal', 'kill_terminal']);
			const writeToolNames = new Set(['write_file', 'edit_file', 'delete_file', 'rename_file']);
			const networkToolNames = new Set(['fetch_web_page']);
			const browserToolNames = new Set(['open_browser_page', 'read_browser_page', 'read_page', 'navigate_browser', 'navigate_page', 'click_element', 'type_in_page', 'scroll_browser_page', 'hover_element', 'press_key', 'select_option', 'drag_and_drop', 'wait_for_browser', 'execute_browser_script', 'get_browser_console_logs', 'handle_browser_dialog', 'screenshot_browser_page', 'screenshot_page']);
			for (const definition of routerToolDefinitions) {
				const name = definition.function.name;
				const dynamicTool = routerDynamicToolByName.get(name);
				const source: AgentToolSource = dynamicTool
					? dynamicTool.source.type === 'extension' || dynamicTool.source.type === 'mcp' || dynamicTool.source.type === 'user' ? dynamicTool.source.type : 'builtin'
					: 'router';
				const risk: AgentToolRisk = dynamicTool
					? 'unknown'
					: commandToolNames.has(name) ? 'command' : writeToolNames.has(name) ? 'write' : networkToolNames.has(name) ? 'network' : browserToolNames.has(name) ? 'browser' : 'read';
				routerToolRuntime.register({ name, inputSchema: definition.function.parameters, source, risk, driver: dynamicTool ? `languageModelToolsService:${dynamicTool.id}` : 'dardcorRouterLocalDriver' }, async (args, toolRequest) => {
					const result: any = await executeRouterTool(name, args, snapshot.rootUri, toolRequest.callId);
					return {
						output: result.output,
						status: isAgentToolExecutionStatus(result.executionStatus) ? result.executionStatus : undefined,
						exitCode: typeof result.exitCode === 'number' ? result.exitCode : undefined,
						evidence: Array.isArray(result.evidence) ? result.evidence.filter((item: unknown): item is string => typeof item === 'string') : undefined,
						retrySafe: typeof result.retrySafe === 'boolean' ? result.retrySafe : undefined,
						details: result,
					};
				});
			}
			const executeRouterToolThroughRuntime = async (toolName: string, args: Record<string, unknown>, callId: string) => {
				const result = await routerToolRuntime.execute({ version: 1, callId, toolName, arguments: args });
				const details = result.details && typeof result.details === 'object' ? result.details as Record<string, unknown> : {};
				return { ...details, output: result.output, executionStatus: result.status };
			};
			const attachedFilesExcerpts: string[] = [];
			if (request.variables?.variables && Array.isArray(request.variables.variables) && fileService) {
				for (const variable of request.variables.variables) {
					const varAny = variable as any;
					if (varAny?.kind === 'file' && URI.isUri(varAny.value)) {
						try {
							const fileData = await fileService.readFile(varAny.value);
							const fileText = fileData.value.toString();
							const maxLen = 8000;
							const truncated = fileText.length > maxLen ? fileText.substring(0, maxLen) + '\n... [content truncated]' : fileText;
							attachedFilesExcerpts.push(`File: ${varAny.value.path || varAny.value.fsPath || varAny.name || 'attached file'}\n\`\`\`\n${truncated}\n\`\`\``);
						} catch { }
					}
				}
			}

			const currentPrompt = typeof request.message === 'string' ? request.message : (request.message as any)?.text || String(request.message || '');
			let cleanedPrompt = currentPrompt.trim();

			if (activeSkills.length > 0) {
				for (const skill of activeSkills) {
					const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					cleanedPrompt = cleanedPrompt.replace(new RegExp(`(?:^|\\s)\\/${escaped}(?=\\s|$)`, 'gi'), '').trim();
				}
			}

			if (attachedFilesExcerpts.length > 0) {
				cleanedPrompt = (cleanedPrompt ? `${cleanedPrompt}\n\n` : '') +
					`=== ATTACHED CONTEXT FILES ===\n${attachedFilesExcerpts.join('\n\n')}\n=== END ATTACHED CONTEXT FILES ===`;
			}

			const trimmedPrompt = cleanedPrompt || (activeSkills.length > 0 ? `Activate and apply skill(s): ${activeSkills.map(s => s.name).join(', ')}` : 'hello');
			const hasPlanSkill = activeSkills.some(s => s.name.toLowerCase() === 'plan');
			const hasPlanVariable = (request.variables?.variables && Array.isArray(request.variables.variables) && (request.variables.variables as any[]).some(v => v?.name?.toLowerCase() === 'plan' || (v?.value?.path && String(v.value.path).includes('plan'))));
			isPlanMode = isPlanMode || hasPlanSkill || hasPlanVariable || /^\s*(?:\/|\[)plan(?:\]|\b)/i.test(currentPrompt);
			if (isPlanMode && commandService) {
				commandService.executeCommand('markdown.api.render', '').catch(() => { });
			}
			const isClarificationQuestion = /^(?:bentar|sebentar|tunggu|wait|hold on|apa itu|kenapa|mengapa|sedang apa|sedang download apa|sedang unduh apa|what are you|what is|why are you)\b/i.test(trimmedPrompt);
			const isContinuation = isDardcorContinuation(trimmedPrompt);
			const previousState = runStateService?.getState(request.sessionResource);
			const existingTodos = todoListService?.getTodos(request.sessionResource) ?? [];
			const hasExistingIncompleteTodos = existingTodos.some(todo => todo.status !== 'completed');
			const hasActivePreviousState = !!previousState && ['paused', 'blocked', 'planning', 'working', 'verifying'].includes(previousState.status);
			const canResume = !isClarificationQuestion && ((isContinuation && hasActivePreviousState) || hasExistingIncompleteTodos || (hasActivePreviousState && isDardcorAutonomousTask(trimmedPrompt)));
			taskIsTracked = !isPlanMode && (canResume || isDardcorAutonomousTask(trimmedPrompt));
			activeTaskPrompt = canResume && previousState?.taskPrompt
				? (isContinuation ? previousState.taskPrompt : `${previousState.taskPrompt}\n\n[User Update / Path & Requirement Correction]: ${trimmedPrompt}`.slice(0, 12000))
				: trimmedPrompt;

			let systemPrompt = buildDardcorSystemPrompt(snapshot, {
				userPrompt: activeTaskPrompt,
				permissionLevel: getEffectiveRouterPermission().permissionLevel,
				activeSkills,
				todos: todoListService?.getTodos(request.sessionResource)
			});

			if (activeSkills.length > 0) {
				let skillDirectives = `\n\n=== ACTIVATED SKILLS & SPECIALIZED DIRECTIVES ===\n` +
					`The user has explicitly activated the following ${activeSkills.length} specialized skill(s) for this task. ` +
					`You MUST strictly adopt, apply, and obey all instructions, rules, patterns, constraints, and behaviors defined below:\n\n`;

				for (const skill of activeSkills) {
					skillDirectives += `--- [SKILL: ${skill.name}] ---\n`;
					if (skill.description) {
						skillDirectives += `Description: ${skill.description}\n\n`;
					}
					skillDirectives += `${skill.body}\n`;
					skillDirectives += `--- [END SKILL: ${skill.name}] ---\n\n`;
				}
				skillDirectives += `=== END ACTIVATED SKILLS ===\n`;

				systemPrompt += skillDirectives;
			}

			if (isPlanMode) {
				systemPrompt += `\n\n=== STRICT PLAN MODE PROTOCOL (/plan) ===\n` +
					`You are currently running in PLAN MODE. The user has asked you to analyze the project and formulate an implementation plan.\n` +
					`1. STRICT READ-ONLY ENFORCEMENT: You must NOT create, edit, or delete any workspace code files. Tools write_file, edit_file, delete_file, and rename_file are strictly disabled for workspace project files.\n` +
					`2. RESEARCH FIRST: Use read_file (small line ranges), grep_search, find_files, and get_file_outline to inspect relevant files.\n` +
					`3. FORMULATE THE PLAN: Call the review_plan tool with your detailed implementation plan. Calling review_plan automatically saves the plan to editor memory and opens it directly in the center editor tab (as a clean GitHub-style Markdown Preview) for the user to review.\n` +
					`   - In your conversational response to the user, DO NOT duplicate or repeat the whole plan text (since it is already opened in the center editor). Instead, provide a concise, friendly executive summary (2-3 sentences explaining what was analyzed, what was planned, and inviting the user to review the preview tab and click "Approve").\n` +
					`4. AWAIT APPROVAL: Once the plan is presented, STOP immediately. Do NOT start implementing or modifying code files until the user explicitly reviews the plan and confirms. When approved, the system will immediately authorize you to start implementing the tasks autonomously.\n`;
			}

			let messages: any[] = [
				{ role: 'system', content: systemPrompt }
			];
			let dynamicFallbackToolsAdded = false;
			const addDynamicFallbackTools = (): void => {
				if (dynamicFallbackToolsAdded || dynamicRouterToolDefinitions.length === 0) {
					return;
				}
				dynamicFallbackToolsAdded = true;
				const definitions = dynamicRouterToolDefinitions.map(tool => `- ${tool.function.name}: ${tool.function.description}\n  JSON schema: ${JSON.stringify(tool.function.parameters)}`).join('\n');
				const omitted = unavailableDynamicTools.length > 0 ? `\nSome active local tools were withheld because they had no valid schema: ${unavailableDynamicTools.slice(0, 12).join(', ')}.` : '';
				messages.splice(1, 0, { role: 'system', content: `LOCAL TOOL SCHEMAS FOR TEXT FALLBACK\nWhen a native tool-call protocol is unavailable, request local tools using a complete JSON tool call. These tool names are validated and dispatched by the local editor runtime; permissions still apply.\n${definitions}${omitted}` });
			};

			for (const h of history) {
				if (h.request?.message) {
					const reqMsg = typeof h.request.message === 'string' ? h.request.message : (h.request.message as any)?.text || String(h.request.message || '');
					if (reqMsg.trim()) {
						messages.push({ role: 'user', content: reqMsg.trim() });
					}
				}
				if (h.response) {
					let respText = '';
					let hasContent = false;
					for (const r of h.response as any[]) {
						if (!r) continue;
						if (typeof r === 'object') {
							if (r.content && typeof r.content === 'object' && typeof r.content.value === 'string') {
								respText += r.content.value;
								hasContent = true;
							} else if (typeof r.content === 'string') {
								respText += r.content;
								hasContent = true;
							} else if (r.kind === 'thinking' && typeof r.value === 'string') {
								if (!hasContent) {
									respText += r.value;
								}
							}
						}
					}
					const toolActionsSummary: string[] = [];
					for (const r of h.response as any[]) {
						if (r && typeof r === 'object' && (r.kind === 'toolInvocationSerialized' || r.kind === 'toolInvocation')) {
							const toolName = r.toolId || r.toolCallId || 'tool';
							const pastMsg = r.pastTenseMessage?.value || r.invocationMessage?.value || '';
							const toolData = r.toolSpecificData?.kind === 'terminal'
								? (r.toolSpecificData.commandLine?.forDisplay || r.toolSpecificData.commandLine?.original || '')
								: (typeof r.toolSpecificData?.output === 'string' ? r.toolSpecificData.output.slice(0, 160) : '');
							toolActionsSummary.push(`[Tool executed: ${toolName}${pastMsg ? ` - ${pastMsg}` : ''}${toolData ? ` | output: ${toolData}` : ''}]`);
						}
					}
					respText = respText.replace(/\*\(No response content returned by model[^\)]*\)\*/g, '').trim();
					let cleanText = DardcorThinkingStreamParser.sanitizeText(respText);
					if (!cleanText && !hasContent && toolActionsSummary.length === 0) {
						cleanText = '[Turn was completed with no text response]';
					} else if (!cleanText && toolActionsSummary.length > 0) {
						cleanText = toolActionsSummary.join('\n');
					} else if (cleanText && toolActionsSummary.length > 0) {
						cleanText = `${toolActionsSummary.join('\n')}\n\n${cleanText}`;
					}
					if (cleanText) {
						messages.push({ role: 'assistant', content: cleanText });
					}
				}
			}
			const previousLastError = previousState?.lastError ?? '';
			const previousRunStoppedOnEvidenceGate = !previousLastError
				|| /(?:Browser verification is missing|No successful verification evidence has been recorded)/i.test(previousLastError);
			if (canResume && previousState && taskIsTracked && previousRunStoppedOnEvidenceGate && previousState.verificationFailures.length === 0) {
				const savedTodos = todoListService?.getTodos(request.sessionResource) ?? [];
				browserVerificationOnly = savedTodos.length > 0
					&& savedTodos.every(todo => todo.status === 'completed')
					&& !!getDardcorBrowserVerificationRequirement(activeTaskPrompt, previousState);
			}
			if (taskIsTracked) {
				if (canResume) {
					const baseState = previousState ?? createChatAgentRunState('working');
					runState = {
						...baseState,
						verificationPending: []
					};
					saveRunState({ status: 'working', stalledTurns: 0, lastError: undefined, taskPrompt: activeTaskPrompt, nextStep: baseState.nextStep || 'Review the checklist and continue from its first incomplete item.' });
					const pendingTodos = todoListService?.getTodos(request.sessionResource) ?? [];
					messages.push({
						role: 'system',
						content: `[Resumable Task Checkpoint]: Continue the saved task: ${activeTaskPrompt}. Prior status=${baseState.status}; completed agent turns=${baseState.turn}; current verification evidence=${baseState.verificationEvidence.filter(item => item.workspaceRevision === baseState.workspaceRevision).map(item => item.message).join(' | ') || 'none'}; stale historical evidence=${baseState.verificationEvidence.filter(item => item.workspaceRevision !== baseState.workspaceRevision).map(item => item.message).join(' | ') || 'none'}; workspace revision=${baseState.workspaceRevision}; unresolved verification failures=${baseState.verificationFailures.join(' | ') || 'none'}; browser actions=${baseState.browserActions}; last issue=${baseState.lastError || 'none'}; next step=${baseState.nextStep || 'review the checklist and continue from its first incomplete item'}. Current checklist: ${JSON.stringify(pendingTodos)}. Preserve completed work, apply any user path or requirement correction immediately, update the checklist, and continue from the first unfinished item until all checklist items are 100% completed.`
					});
				} else {
					runState = createChatAgentRunState('planning');
					try { todoListService?.setTodos(request.sessionResource, []); } catch { }
					saveRunState({ taskPrompt: trimmedPrompt.slice(0, 12000), nextStep: 'Create a checklist from the user requirements, then begin the first incomplete item.' });
				}
			}

			if (isContinuation) {
				messages.push({
					role: 'user',
					content: `${trimmedPrompt}\n\n[System Directive]: The user is asking you to continue the task. Review your previous work and the workspace state, and proceed immediately with the next steps using tools or provide the complete continuation.`
				});
			} else if (isClarificationQuestion && previousState && ['paused', 'blocked', 'working'].includes(previousState.status)) {
				const lang = detectDardcorLanguage(trimmedPrompt);
				const directive = lang === 'id'
					? `[System Directive]: Pengguna menjeda tugas sebelumnya untuk mengajukan pertanyaan klarifikasi ("${trimmedPrompt}"). Jawab pertanyaan pengguna secara langsung, ramah, dan jelas tanpa menjalankan tools yang berat atau melanjutkan download/modifikasi sebelum pengguna secara spesifik menginstruksikannya.`
					: `[System Directive]: The user paused the previous task to ask a clarification question ("${trimmedPrompt}"). Answer the user's question directly, concisely, and warmly without executing heavy tools, background downloads, or workspace modifications until the user explicitly directs you to proceed.`;
				messages.push({
					role: 'user',
					content: `${trimmedPrompt}\n\n${directive}`
				});
			} else {
				messages.push({ role: 'user', content: trimmedPrompt });
			}
			try {
				const modelsData = await getCachedRouterModelsData();
				if (modelsData) {
					if (Array.isArray(modelsData?.data) && modelsData.data.length > 0) {
						if (!modelName) {
							modelName = modelsData.data[0].id;
						} else {
							const raw = modelName.trim();
							const exactMatch = modelsData.data.find((m: any) => m?.id === raw || m?.id?.toLowerCase() === raw.toLowerCase());
							if (exactMatch) {
								modelName = exactMatch.id;
							} else if (raw.includes('/')) {
								const slashIdx = raw.indexOf('/');
								const rawProvider = raw.slice(0, slashIdx).toLowerCase().trim();
								const subModel = raw.slice(slashIdx + 1).toLowerCase().trim();
								const canonicalPrefix = DARDCOR_PROVIDER_ALIAS_MAP[rawProvider] || rawProvider;

								const providerScopedMatch = modelsData.data.find((m: any) => {
									if (!m?.id) return false;
									const mId = m.id.toLowerCase();
									const hasMatchingPrefix = mId.startsWith(`${canonicalPrefix}/`) || mId.startsWith(`${rawProvider}/`);
									if (!hasMatchingPrefix) return false;

									return mId === `${canonicalPrefix}/${subModel}` ||
										mId === `${rawProvider}/${subModel}` ||
										mId.endsWith(`/${subModel}`);
								});

								if (providerScopedMatch) {
									modelName = providerScopedMatch.id;
								} else {
									// STRICT PROVIDER & MODEL ISOLATION: Never switch to a different provider OR a different model!
									modelName = `${canonicalPrefix}/${raw.slice(slashIdx + 1).trim()}`;
								}
							} else {
								const bareTarget = raw.toLowerCase();
								const bareMatch = modelsData.data.find((m: any) => {
									if (!m?.id) return false;
									const mId = m.id.toLowerCase();
									return mId === bareTarget || mId.endsWith(`/${bareTarget}`);
								});
								if (bareMatch) {
									modelName = bareMatch.id;
								} else if (bareTarget.endsWith('-free') || bareTarget === 'big-pickle') {
									// OpenCode free models without prefix -> route strictly to OpenCode with the exact requested model
									modelName = `oc/${raw}`;
								} else {
									// STRICT PROVIDER ISOLATION: Keep raw model, never switch to data[0].id
									modelName = raw;
								}
							}
						}
					} else {
						modelName = undefined;
					}
				} else {
					modelName = undefined;
				}
			} catch {
				modelName = undefined;
			}
			if (typeof modelName === 'string') {
				if (modelName.includes('/')) {
					const slash = modelName.indexOf('/');
					const p = modelName.slice(0, slash).toLowerCase();
					const rest = modelName.slice(slash + 1);
					if (DARDCOR_PROVIDER_ALIAS_MAP[p]) {
						modelName = `${DARDCOR_PROVIDER_ALIAS_MAP[p]}/${rest}`;
					}
				}
				if (modelName.toLowerCase().startsWith('opencode/')) modelName = `oc/${modelName.slice('opencode/'.length)}`;
				if (!modelName.includes('/') && (modelName.toLowerCase().endsWith('-free') || modelName.toLowerCase() === 'big-pickle')) modelName = `oc/${modelName}`;
			}
			if (modelName) {
				try {
					routerModelCapabilities = await getCachedRouterModelCapabilities(modelName);
				} catch (error) {
					console.debug('[streamDardcorRouter] Model capability metadata is unavailable; using a compatible best-effort mode.', error);
				}
			}

			if (!modelName) {
				if (taskIsTracked) {
					const reason = 'No connected Router model is configured for this task.';
					saveRunState({ status: 'blocked', lastError: reason, nextStep: 'Connect a model in Dardcor Router, then resume from the saved checklist.' });
				}
				const md = new MarkdownString('No AI model is configured. Please configure at least one provider in [Dardcor Router](http://localhost:25128/) to start chatting.');
				md.isTrusted = true;
				progress([{
					kind: 'markdownContent',
					content: md
				}]);

				return {};
			}

			// Normalize message roles to guarantee strict alternation for Anthropic / strict providers
			const normalizedMessages: any[] = [];
			for (const m of messages) {
				if (m.role === 'system') {
					normalizedMessages.push(m);
					continue;
				}
				const last = normalizedMessages.length > 0 ? normalizedMessages[normalizedMessages.length - 1] : null;
				if (last && last.role !== 'system' && last.role === m.role) {
					if (m.role === 'user') {
						if (typeof last.content === 'string' && typeof m.content === 'string') {
							last.content = `${last.content}\n\n${m.content}`;
						} else {
							normalizedMessages.push({ role: 'assistant', content: '[Continuing based on previous instructions]' });
							normalizedMessages.push(m);
						}
					} else if (m.role === 'assistant') {
						if (typeof last.content === 'string' && typeof m.content === 'string') {
							last.content = `${last.content}\n\n${m.content}`;
						} else {
							normalizedMessages.push({ role: 'user', content: '[Continue]' });
							normalizedMessages.push(m);
						}
					}
				} else {
					normalizedMessages.push(m);
				}
			}
			messages = normalizedMessages;

			let turn = runState?.turn ?? 0;
			let supportsNativeTools = routerModelCapabilities.tools !== false;
			if (!supportsNativeTools) {
				addDynamicFallbackTools();
			}
			let consecutiveTextTurns = 0;
			let consecutiveEmptyTurns = 0;
			let emptyReasoningTurns = 0;
			const MAX_CONSECUTIVE_TEXT_TURNS = 5;
			const MAX_STREAM_RETRIES = 5;

			if (taskIsTracked && JSON.stringify(messages).length >= DARDCOR_AGENT_COMPACTION_THRESHOLD_CHARS) {
				const initialCompaction = compactDardcorAgentMessages(messages);
				if (initialCompaction.compactedItemsCount > 0) {
					messages = initialCompaction.messages;
				}
			}

			while (true) {
				const activeLoopTodos = todoListService?.getTodos(request.sessionResource) ?? [];
				const hasIncompleteLoopTodos = activeLoopTodos.some(t => t.status !== 'completed');
				if (!taskIsTracked && activeLoopTodos.length > 0) {
					taskIsTracked = true;
					if (!runState) {
						runState = createChatAgentRunState('working');
						saveRunState({ status: 'working', taskPrompt: activeTaskPrompt.slice(0, 12000) });
					}
				}
				if (taskIsTracked) {
					let contextChars = JSON.stringify(messages).length;
					if (contextChars >= DARDCOR_AGENT_COMPACTION_THRESHOLD_CHARS) {
						const compaction = compactDardcorAgentMessages(messages);
						if (compaction.compactedItemsCount > 0) {
							messages = compaction.messages;
							contextChars = compaction.compactedChars;
						}
					}
					const guardReason = getDardcorRunGuardReason(contextChars);
					if (guardReason) {
						saveRunState({ status: 'paused', lastError: guardReason, nextStep: 'Resume this task after reviewing the saved checklist and first unfinished item.' });
						break;
					}
				}
				turn++;
				if (token.isCancellationRequested) {
					if (taskIsTracked) {
						saveRunState({ status: 'paused', lastError: 'The run was cancelled before the task completion gate passed.', nextStep: 'Resume from the first incomplete checklist item and inspect any interrupted action.' });
					}
					break;
				}
				saveRunState({ turn, nextStep: 'Review the checklist, take the next concrete action, then verify the result.' });

				const payload: any = {
					model: modelName,
					messages,
					stream: true,
					max_tokens: 16384
				};
				if (supportsNativeTools && !finalSynthesisTurnPending) {
					payload.tools = browserVerificationOnly
						? routerToolDefinitions.filter(tool => DARDCOR_BROWSER_VERIFICATION_TOOL_NAMES.has(tool.function.name))
						: routerToolDefinitions;
					payload.tool_choice = (browserVerificationOnly || ((taskIsTracked || hasIncompleteLoopTodos) && consecutiveTextTurns > 0)) ? 'required' : 'auto';
				}

				let streamedAssistantText = '';
				let streamedReasoningText = '';
				let previouslyEmittedAssistantLength = 0;
				let previouslyEmittedReasoningLength = 0;
				let assistantTextRoutedToThinking = false;
				let rawAssistantText = '';
				let streamProtocolErrors: string[] = [];
				const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

				let streamAttempt = 0;
				let streamSucceeded = false;
				let lastStreamError: any = undefined;
				let sawStreamTerminal = false;

				while (streamAttempt < MAX_STREAM_RETRIES && !streamSucceeded) {
					streamAttempt++;
					if (token.isCancellationRequested) break;

					const attemptStore = new DisposableStore();
					try {
						const turnAbortController = new AbortController();
						attemptStore.add(token.onCancellationRequested(() => {
							try { turnAbortController.abort(new Error('User cancelled agent turn')); } catch { }
						}));

					streamedAssistantText = '';
					streamedReasoningText = '';
					previouslyEmittedAssistantLength = 0;
					previouslyEmittedReasoningLength = 0;
					assistantTextRoutedToThinking = false;
					rawAssistantText = '';
					streamProtocolErrors = [];
					toolCallsMap.clear();
					sawStreamTerminal = false;

					let res: Response;
					try {
						res = await fetchRouter('/v1/chat/completions', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
							body: JSON.stringify(payload),
							signal: turnAbortController.signal
						}, 3, 60000);
					} catch (fetchErr: any) {
						lastStreamError = fetchErr;
						if (streamAttempt < MAX_STREAM_RETRIES && !token.isCancellationRequested) {
							const backoffMs = Math.min(1000 * Math.pow(2, streamAttempt - 1), 6000);
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(`\n\n> *Stream connection interrupted. Reconnecting to model... (Attempt ${streamAttempt}/${MAX_STREAM_RETRIES} in ${Math.round(backoffMs / 1000)}s)*\n\n`)
							}]);
							await new Promise(r => setTimeout(r, backoffMs));
							continue;
						} else {
							break;
						}
					}

					let responseErrorText: string | undefined;
					if (!res.ok && (res.status === 400 || res.status === 422) && payload.tool_choice === 'required') {
						payload.tool_choice = 'auto';
						try {
							res = await fetchRouter('/v1/chat/completions', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
								body: JSON.stringify(payload),
								signal: turnAbortController.signal
							}, 3, 60000);
						} catch (retryError) {
							lastStreamError = retryError;
							continue;
						}
					}
					if (!res.ok && (res.status === 400 || res.status === 422)) {
						responseErrorText = await res.text();
						if (supportsNativeTools && isDardcorNativeToolCompatibilityError(res.status, responseErrorText)) {
							supportsNativeTools = false;
							addDynamicFallbackTools();
							delete payload.tools;
							delete payload.tool_choice;
							try {
								res = await fetchRouter('/v1/chat/completions', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
									body: JSON.stringify(payload),
									signal: turnAbortController.signal
								}, 3, 60000);
								responseErrorText = undefined;
							} catch (retryError) {
								lastStreamError = retryError;
								continue;
							}
						}
					}

					if (!res.ok && payload.max_tokens !== undefined) {
						responseErrorText ??= await res.text();
						if (isDardcorMaxTokensCompatibilityError(res.status, responseErrorText)) {
							delete payload.max_tokens;
							try {
								res = await fetchRouter('/v1/chat/completions', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
									body: JSON.stringify(payload),
									signal: turnAbortController.signal
								}, 3, 60000);
								responseErrorText = undefined;
							} catch (retryError) {
								lastStreamError = retryError;
								continue;
							}
						}
					}

					if (!res.ok) {
						const errorText = responseErrorText ?? await res.text();
						const parsedError = parseDardcorRouterError(res.status, errorText, modelName);
						const isNonRetryable = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 404 ||
							parsedError.isInsufficientCredits || parsedError.isForbiddenPlan || parsedError.isUnauthorized ||
							/FreeUsageLimitError|free usage limit|quota exceeded|insufficient_credits|credits required|insufficient balance|payment required|unauthorized|pricingUrl|model_not_found/i.test(errorText);

						const retryHeader = res.headers?.get?.('Retry-After');
						const cooldownSec = parsedError.resetAfterSec
							|| (retryHeader ? parseInt(retryHeader, 10) : undefined)
							|| parseResetSeconds(errorText);

						const isTransientCooldown = !isNonRetryable && cooldownSec !== undefined && cooldownSec > 0 && cooldownSec <= 120;

						if (isTransientCooldown && !token.isCancellationRequested && streamAttempt <= MAX_STREAM_RETRIES + 2) {
							const lang = detectDardcorLanguage(activeTaskPrompt);
							const modelDisplayName = formatModelDisplayName(parsedError.model || modelName || 'Model');
							const waitNotice = lang === 'id'
								? `⏳ *[Sistem Menunggu]* Kuota model **${modelDisplayName}** sedang cooldown oleh provider. Menunggu otomatis selama **${cooldownSec} detik** sebelum melanjutkan... (Auto-resume aktif)`
								: `⏳ *[System Waiting]* Model **${modelDisplayName}** is currently on provider cooldown. Waiting **${cooldownSec}s** before automatically resuming... (Auto-resume active)`;

							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(`\n\n> ${waitNotice}\n\n`)
							}]);

							const waitMs = (cooldownSec + 1) * 1000;
							const stepMs = 1000;
							let elapsed = 0;
							while (elapsed < waitMs && !token.isCancellationRequested) {
								const sleepChunk = Math.min(stepMs, waitMs - elapsed);
								await new Promise(r => setTimeout(r, sleepChunk));
								elapsed += sleepChunk;
							}

							if (token.isCancellationRequested) {
								return {};
							}

							responseErrorText = undefined;
							continue;
						}

						if (!isNonRetryable && streamAttempt < MAX_STREAM_RETRIES && (res.status === 429 || res.status >= 500) && !token.isCancellationRequested) {
							const backoffMs = Math.min(2000 * Math.pow(2, streamAttempt - 1), 8000);
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(`\n\n> *Model gateway returned HTTP ${res.status}. Retrying... (Attempt ${streamAttempt}/${MAX_STREAM_RETRIES} in ${Math.round(backoffMs / 1000)}s)*\n\n`)
							}]);
							await new Promise(r => setTimeout(r, backoffMs));
							continue;
						}

						progress([{
							kind: 'markdownContent',
							content: new MarkdownString(formatDardcorRouterError(res.status, errorText, modelName))
						}]);
						turnEncounteredFatalModelError = true;
						if (taskIsTracked) {
							const lang = detectDardcorLanguage(activeTaskPrompt);
							const diagnosis = diagnoseProviderIssue(res.status, errorText, modelName, lang);
							const status = 'blocked';
							saveRunState({
								status,
								lastError: diagnosis.description,
								nextStep: lang === 'id'
									? 'Pilih model pengganti pada pemilih model di kanan bawah.'
									: 'Please select a replacement model in the bottom-right model picker.'
							});
						}
						return {};
					}

					const reader = res.body?.getReader();
					if (!reader) {
						lastStreamError = new Error('No readable response body');
						continue;
					}

					const decoder = new TextDecoder();
					let buffer = '';
					const isolateIntermediateTextAsThinking = (taskIsTracked || hasIncompleteLoopTodos || activeLoopTodos.length > 0 || turn > 1) && !finalSynthesisTurnPending;

					const thinkingParser = new DardcorThinkingStreamParser({
						onThinking: (chunk: string) => {
							streamedReasoningText += chunk;
							if (streamedReasoningText.length > previouslyEmittedReasoningLength) {
								const delta = streamedReasoningText.slice(previouslyEmittedReasoningLength);
								previouslyEmittedReasoningLength = streamedReasoningText.length;
								progress([{ kind: 'thinking', value: delta }]);
							}
						},
						onMarkdownContent: (chunk: string) => {
							streamedAssistantText += chunk;
							if (streamedAssistantText.length > previouslyEmittedAssistantLength) {
								const delta = streamedAssistantText.slice(previouslyEmittedAssistantLength);
								previouslyEmittedAssistantLength = streamedAssistantText.length;
								const isMonologue = isInternalThinkingMonologue(streamedAssistantText.trim());
								if (isolateIntermediateTextAsThinking || isMonologue) {
									assistantTextRoutedToThinking = true;
									progress([{ kind: 'thinking', value: delta }]);
								} else {
									progress([{ kind: 'markdownContent', content: new MarkdownString(delta) }]);
								}
							}
						},
						onRetroactiveReclassify: (leakedMarkdown: string) => {
							if (streamedAssistantText.length > 0) {
								const monologue = streamedAssistantText;
								streamedReasoningText += (streamedReasoningText ? '\n' : '') + monologue;
								streamedAssistantText = '';
							}
						}
					});

					const cancelListener = token.onCancellationRequested(() => {
						try { turnAbortController.abort(new Error('User cancelled chat streaming')); } catch { }
						try { reader.cancel('User cancelled chat streaming'); } catch { }
					});

					const readWithTimeout = (r: typeof reader) => {
						return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
							const timer = setTimeout(() => {
								try { r.cancel(); } catch { }
								reject(new Error('Stream idle timeout'));
							}, 90000);
							r.read().then(
								readVal => { clearTimeout(timer); resolve(readVal); },
								err => { clearTimeout(timer); reject(err); }
							);
						});
					};

					const processSSELine = (line: string) => {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith('data:')) return;
						const jsonStr = trimmed.slice(5).trim();
						if (jsonStr === '[DONE]') {
							sawStreamTerminal = true;
							return;
						}
						try {
							const parsed = JSON.parse(jsonStr);
							if (isDardcorRouterStreamTerminal(parsed)) {
								sawStreamTerminal = true;
							}
							const choice = parsed.choices?.[0];
							const delta = choice?.delta?.content
								?? choice?.delta?.text
								?? choice?.message?.content
								?? (typeof choice?.text === 'string' ? choice.text : '')
								?? '';
							const reasoningDelta = choice?.delta?.reasoning_content
								?? choice?.delta?.reasoning
								?? choice?.delta?.reasoningContent
								?? choice?.delta?.thought
								?? choice?.delta?.thinking
								?? choice?.message?.reasoning_content
								?? choice?.message?.reasoning
								?? choice?.message?.thought
								?? '';

							if (reasoningDelta) {
								thinkingParser.processReasoningDelta(reasoningDelta);
							}

							if (delta) {
								rawAssistantText += delta;
								thinkingParser.processContentDelta(delta);
							}

							if (Array.isArray(choice?.delta?.tool_calls)) {
								for (const tc of choice.delta.tool_calls) {
									const idx = tc.index ?? 0;
									const existing = toolCallsMap.get(idx) || { id: tc.id || `call_${idx}_${Date.now()}`, name: '', arguments: '' };
									if (tc.id) existing.id = tc.id;
									if (tc.function?.name) {
										const newName = tc.function.name;
										if (!existing.name) {
											existing.name = newName;
										} else if (existing.name === newName) {
											// repeated full name from provider delta
										} else if (newName.startsWith(existing.name)) {
											existing.name = newName;
										} else if (!existing.name.endsWith(newName)) {
											existing.name += newName;
										}
									}
									if (tc.function?.arguments) existing.arguments += tc.function.arguments;
									toolCallsMap.set(idx, existing);
								}
							}
						} catch (error) {
							if (streamProtocolErrors.length < 8) {
								streamProtocolErrors.push(error instanceof Error ? error.message : String(error));
							}
						}
					};

					try {
						while (true) {
							if (token.isCancellationRequested) {
								try { reader.cancel(); } catch { }
								break;
							}
							const readResult = await raceCancellation(readWithTimeout(reader), token);
							if (token.isCancellationRequested) {
								try { reader.cancel(); } catch { }
								break;
							}
							if (!readResult) {
								throw new Error('Router stream read was interrupted before completion.');
							}
							if (readResult.done) {
								if (buffer && buffer.trim()) {
									const remainingLines = buffer.split('\n');
									for (const l of remainingLines) {
										processSSELine(l);
									}
									buffer = '';
								}
								break;
							}
							const value = readResult.value;
							buffer += decoder.decode(value, { stream: true });
							const lines = buffer.split('\n');
							buffer = lines.pop() ?? '';
							for (const line of lines) {
								processSSELine(line);
							}
						}
						thinkingParser.flush();
						if (token.isCancellationRequested) {
							throw new Error('Router stream was cancelled before completion.');
						}
						if (streamProtocolErrors.length > 0 && toolCallsMap.size > 0) {
							throw new Error('Router stream contained malformed frames alongside tool calls; partial actions were not executed.');
						}
						if (toolCallsMap.size > 0 && !sawStreamTerminal && !token.isCancellationRequested) {
							throw new Error('Router stream ended before a terminal frame; partial tool calls were not executed.');
						}
						streamSucceeded = true;
					} catch (streamErr: any) {
						lastStreamError = streamErr;
						if (!token.isCancellationRequested) {
							console.warn(`[streamDardcorRouter] stream reading error (attempt ${streamAttempt}/${MAX_STREAM_RETRIES}):`, streamErr);
							if (streamAttempt < MAX_STREAM_RETRIES) {
								const backoffMs = Math.min(1000 * Math.pow(2, streamAttempt - 1), 6000);
								progress([{
									kind: 'markdownContent',
									content: new MarkdownString(`\n\n> *Stream connection interrupted. Reconnecting to model... (Attempt ${streamAttempt}/${MAX_STREAM_RETRIES} in ${Math.round(backoffMs / 1000)}s)*\n\n`)
								}]);
								await new Promise(r => setTimeout(r, backoffMs));
							}
						}
					} finally {
						cancelListener.dispose();
						try { reader.cancel(); } catch { }
					}
					} finally {
						attemptStore.dispose();
					}
				}

				if (!streamSucceeded) {
					turnEncounteredFatalModelError = true;
					const reason = token.isCancellationRequested
						? 'The Router response was cancelled before a complete response arrived.'
						: `The Router response stream did not complete after ${MAX_STREAM_RETRIES} attempts${lastStreamError instanceof Error ? `: ${lastStreamError.message}` : '.'}`;
					if (taskIsTracked) {
						const status = token.isCancellationRequested ? 'paused' : 'blocked';
						saveRunState({ status, lastError: reason, nextStep: 'Periksa koneksi router atau pilih model lain, lalu kirim continue.' });
					} else {
						progress([{ kind: 'markdownContent', content: new MarkdownString(`Router response was incomplete and no partial tool call was executed. ${reason}`) }]);
					}
					break;
				}

				streamedAssistantText = DardcorThinkingStreamParser.sanitizeText(streamedAssistantText);

				const allNativeToolCalls = Array.from(toolCallsMap.values());
				const incompleteNativeToolCalls = allNativeToolCalls.filter(call => !call.name.trim());
				const rawNativeToolCalls = allNativeToolCalls.filter(call => call.name.trim().length > 0);
				const nativeToolCalls = rawNativeToolCalls.map(call => {
					const parsed = parseDardcorAgentToolArguments(call.name, call.arguments, routerToolDefinitions);
					return { ...call, name: parsed.name, parsedArgs: parsed.args, parseError: parsed.error };
				});
				const rawTextToolCalls = nativeToolCalls.length === 0 ? this._parseTextToolCalls(rawAssistantText || streamedAssistantText || streamedReasoningText) : [];
				if (nativeToolCalls.length === 0 && rawTextToolCalls.length === 0 && incompleteNativeToolCalls.length > 0) {
					rawTextToolCalls.push({ name: '__incomplete_tool_call__', args: {} });
				}
				const textToolCalls = rawTextToolCalls.map(call => {
					const parsed = parseDardcorAgentToolArguments(call.name, call.args, routerToolDefinitions);
					return { ...call, name: parsed.name, args: parsed.args, parseError: parsed.error };
				});
				if (streamProtocolErrors.length > 0 && nativeToolCalls.length === 0 && textToolCalls.length === 0) {
					const detail = streamProtocolErrors.slice(0, 3).join('; ').slice(0, 400);
					console.warn('[streamDardcorRouter] Ignored malformed SSE frame(s):', detail);
					if (consecutiveEmptyTurns < 2 && !token.isCancellationRequested) {
						consecutiveEmptyTurns++;
						if (streamedAssistantText) {
							messages.push({ role: 'assistant', content: streamedAssistantText });
						}
						messages.push({ role: 'user', content: `[Router stream protocol error]: One or more response frames were invalid JSON and were discarded (${detail}). Retry with a complete response. Any action not represented by a complete validated tool call was not executed.` });
						continue;
					}
					const reason = `Router returned malformed streaming data repeatedly: ${detail}`;
					if (taskIsTracked) {
						saveRunState({ status: 'blocked', lastError: reason, nextStep: 'Check Router/provider streaming compatibility, then resume the saved checklist.' });
					} else {
						progress([{ kind: 'markdownContent', content: new MarkdownString(`Router returned invalid streaming JSON frames and no action was executed: ${detail}`) }]);
					}
					break;
				}

				if (taskIsTracked && isDardcorAutonomousTask(activeTaskPrompt) && nativeToolCalls.length === 0 && textToolCalls.length === 0 && turn <= 12) {
					const isToolApology = /(?:tidak ada alat|tidak memiliki alat|alat .* tidak tersedia|tools? (?:are|is) not available|asisten percakapan|conversational assistant|cannot interact|tidak dapat berinteraksi|cannot access (?:the )?workspace|tidak dapat mengakses workspace|tidak bisa mengakses workspace|tempelkan (?:hasil|output|kode|berkas|file|materi|struktur)|kirimkan (?:hasil|output|kode|berkas|file|proyek|project|struktur)|belum menerima file|belum ada file|jalankan `?(?:tree|ls|dir)`?|bantu (?:cek|periksa) strukturnya)/i.test(streamedAssistantText);
					if (isToolApology) {
						const extractedFile = this._extractFilePathFromApologyOrText(streamedAssistantText);
						if (extractedFile) {
							textToolCalls.push({
								name: 'read_file',
								args: { filePath: extractedFile },
								parseError: undefined
							});
						} else {
							textToolCalls.push({
								name: 'list_directory',
								args: { dirPath: '.' },
								parseError: undefined
							});
						}
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString('\n\n*(Memaksa inisialisasi agen otonom & sinkronisasi workspace...)*\n\n')
						}]);
					}
				}

				if (!streamSucceeded && !streamedAssistantText && !streamedReasoningText && nativeToolCalls.length === 0) {
					if (lastStreamError) {
						console.warn('[streamDardcorRouter] stream failed completely:', lastStreamError);
					}
					if (taskIsTracked) {
						const reason = token.isCancellationRequested ? 'Router stream cancelled by the user.' : (lastStreamError?.message || 'Router stream failed before a response was received.');
						saveRunState({ status: token.isCancellationRequested ? 'paused' : 'blocked', lastError: reason });
					}
					if (!token.isCancellationRequested) {
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString('*(Connection lost. Please verify your connection or try another model in [Dardcor Router](http://localhost:25128/).)*')
						}]);
					}
					return {};
				}

				if (!streamedAssistantText && streamedReasoningText.trim().length > 0 && nativeToolCalls.length === 0 && textToolCalls.length === 0) {
					if (taskIsTracked || hasIncompleteLoopTodos || activeLoopTodos.length > 0) {
						if (finalSynthesisTurnPending) {
							if (emptyReasoningTurns < 1 && !token.isCancellationRequested) {
								emptyReasoningTurns++;
								messages.push({
									role: 'assistant',
									content: `[Reasoning thoughts:\n${streamedReasoningText.trim()}]`
								});
								messages.push({
									role: 'user',
									content: '[System Directive]: Reasoning complete. Output your final comprehensive summary report directly in Markdown now without repeating the thinking process.'
								});
								continue;
							}
							const cleanAnswer = DardcorThinkingStreamParser.sanitizeText(this._extractResponseFromReasoning(streamedReasoningText));
							streamedAssistantText = cleanAnswer;
							assistantTextRoutedToThinking = false;
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(cleanAnswer)
							}]);
						} else {
							streamedAssistantText = streamedReasoningText.trim();
							assistantTextRoutedToThinking = true;
						}
					} else if (emptyReasoningTurns < 1 && turn < 3 && !token.isCancellationRequested) {
						emptyReasoningTurns++;
						messages.push({
							role: 'assistant',
							content: `[Reasoning thoughts:\n${streamedReasoningText.trim()}]`
						});
						messages.push({
							role: 'user',
							content: '[System Directive]: Reasoning complete. Based on your thoughts above, output your final response to the user directly now without repeating the thinking process.'
						});
						continue;
					} else {
						const cleanAnswer = DardcorThinkingStreamParser.sanitizeText(this._extractResponseFromReasoning(streamedReasoningText));
						streamedAssistantText = cleanAnswer;
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString(cleanAnswer)
						}]);
					}
				}

				if (!streamedAssistantText && !streamedReasoningText && nativeToolCalls.length === 0 && textToolCalls.length === 0) {
					const activeTodos = todoListService?.getTodos(request.sessionResource) ?? [];
					const incomplete = activeTodos.filter(t => t.status !== 'completed');
					const maxEmptyTurns = incomplete.length > 0 ? 4 : 2;
					if (consecutiveEmptyTurns < maxEmptyTurns && !token.isCancellationRequested) {
						consecutiveEmptyTurns++;
						if (supportsNativeTools && consecutiveEmptyTurns >= 2) {
							supportsNativeTools = false;
							addDynamicFallbackTools();
						}
						const retryPrompt = incomplete.length > 0
							? `[System Autonomous Momentum]: Empty frame received, but the task is STILL IN PROGRESS (${activeTodos.length - incomplete.length}/${activeTodos.length} completed). Current pending item: "${incomplete[0].title}". Invoke the appropriate tool now to continue.`
							: '[System Quality Guard]: No output was generated. Please answer the user prompt directly.';
						messages.push({
							role: 'user',
							content: retryPrompt
						});
						continue;
					}
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString('*(No response content returned by model. Please verify your connection or try another model in [Dardcor Router](http://localhost:25128/).)*')
					}]);
					break;
				}
				consecutiveEmptyTurns = 0;

				if (nativeToolCalls.length > 0) {
					if (finalSynthesisTurnPending) {
						finalSynthesisCompleted = true;
						finalSynthesisTurnPending = false;
						saveRunState({ status: 'completed', stalledTurns: 0, lastError: undefined });
						break;
					}
					consecutiveTextTurns = 0;
					const isTaskCompleted = nativeToolCalls.some(tc => tc.name === 'task_completed' || tc.name === 'complete_task');
					let completionRejectedReason: string | undefined;
					let completionArgs: any;
					let toolRunBlocked = false;
					let toolRunInterrupted = false;
					const pendingBrowserImages: Array<{ mimeType: 'image/png'; base64: string }> = [];
					const assistantToolCalls = nativeToolCalls.map(tc => ({
						id: tc.id,
						type: 'function',
						function: { name: tc.name, arguments: tc.arguments }
					}));

					messages.push({
						role: 'assistant',
						content: streamedAssistantText || null,
						tool_calls: assistantToolCalls
					});

					for (const tc of nativeToolCalls) {
						const parsedArgs: any = tc.parsedArgs ?? {};

						const filePath = extractAgentFilePath(parsedArgs);
						if (filePath && !parsedArgs.filePath) {
							parsedArgs.filePath = filePath;
						}

						let targetUri: URI | undefined;
						if (['write_file', 'edit_file', 'delete_file'].includes(tc.name) && filePath) {
							targetUri = resolveAgentUri(filePath, snapshot.rootUri);
						}

						if (chatEditingService && targetUri) {
							chatEditingService.setSessionRunning?.(request.sessionResource, true, [targetUri]);
						}

						let toolResult: { output: string; executionStatus?: AgentToolExecutionStatus; browserImage?: { mimeType: 'image/png'; base64: string }; nativeToolInvocation?: boolean; externalEdit?: { uri: URI; editKind: 'create' | 'edit' | 'delete'; initialContent?: string; diff: { added: number; removed: number } } };
						if (tc.parseError) {
							toolResult = { output: `Tool call rejected: ${tc.parseError}`, executionStatus: 'rejected' };
						} else if (tc.name === 'task_completed' && (completionRejectedReason = completionBlocker(parsedArgs))) {
							toolResult = { output: `Completion request rejected: ${completionRejectedReason}`, executionStatus: 'rejected' };
						} else {
							if (tc.name === 'task_completed' || tc.name === 'complete_task') {
								acceptedTaskCompletion = true;
								completionArgs = parsedArgs;
								proposedCompletionSummary = typeof parsedArgs?.summary === 'string' ? parsedArgs.summary : undefined;
							}
							toolResult = await executeRouterToolThroughRuntime(tc.name, parsedArgs, tc.id) as typeof toolResult;
						}
						if ((tc.name === 'task_completed' || tc.name === 'complete_task') && acceptedTaskCompletion) {
							const completionSummary = (typeof parsedArgs?.summary === 'string' ? parsedArgs.summary : '').trim();
							if (completionSummary.length >= 280) {
								progress([{
									kind: 'markdownContent',
									content: new MarkdownString(`\n\n${completionSummary}\n\n`)
								}]);
								taskConclusionSummaryEmitted = true;
								finalSynthesisCompleted = true;
							}
						}
						recordToolEvidence(tc.name, parsedArgs, toolResult.output, toolResult.externalEdit, toolResult.executionStatus);
						if (noteToolFailure(toolResult.output, toolResult.executionStatus)) {
							if (isFullAccessActive() && autonomousRecoveryAttempts < MAX_AUTONOMOUS_RECOVERY_ATTEMPTS) {
								autonomousRecoveryAttempts++;
								consecutiveToolFailures = 0;
								toolRunBlocked = false;
								const errorPreview = toolResult.output.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
								const userLang = detectDardcorLanguage(activeTaskPrompt);
								messages.push({
									role: 'user',
									content: getDardcorAutonomousSelfCorrectionDirective(userLang, errorPreview)
								});
							} else {
								toolRunBlocked = true;
								saveRunState({ status: 'blocked', lastError: toolResult.output.slice(0, 500) });
							}
						}

						if (chatEditingService) {
							chatEditingService.setSessionRunning?.(request.sessionResource, false, []);
							if (toolResult.externalEdit) {
								await chatEditingService.registerFileEdit?.(
									request.sessionResource,
									toolResult.externalEdit.uri,
									toolResult.externalEdit.editKind,
									toolResult.externalEdit.initialContent,
									request.requestId,
									tc.id,
									toolResult.externalEdit.diff
								);
							}
						}

						const display = this._getToolDisplayInfo(tc.name, parsedArgs);

						if (toolResult.externalEdit) {
							progress([{
								kind: 'externalEdit',
								uri: toolResult.externalEdit.uri,
								editKind: toolResult.externalEdit.editKind,
								diff: toolResult.externalEdit.diff,
								undoStopId: tc.id
							}]);
						}

						if (!toolResult.nativeToolInvocation) {
						progress([{
							kind: 'toolInvocationSerialized',
							toolCallId: tc.id,
							toolId: tc.name,
							source: ToolDataSource.Internal,
							invocationMessage: new MarkdownString(display.invocationMessage),
							originMessage: undefined,
							pastTenseMessage: new MarkdownString(display.pastTenseMessage),
							isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
							isComplete: true,
							presentation: (toolResult.externalEdit || tc.name === 'task_completed' || tc.name === 'complete_task' || tc.name === 'review_plan') ? ToolInvocationPresentation.Hidden : undefined,
							toolSpecificData: (tc.name === 'run_command' || tc.name === 'run_in_terminal' || tc.name === 'confirm_terminal_command') ? {
								kind: 'terminal',
								commandLine: {
									original: (parsedArgs.command || parsedArgs.commandLine || ''),
									forDisplay: (parsedArgs.command || parsedArgs.commandLine || '')
								},
								language: isWindows ? 'powershell' : 'sh',
								terminalCommandOutput: {
									text: toolResult.output,
									lineCount: (toolResult.output || '').split('\n').length
								},
								terminalCommandState: {
									exitCode: parseAgentCommandExitCode(toolResult.output),
									timestamp: Date.now()
								}
							} : {
								kind: 'simpleToolInvocation',
								input: display.formattedInput,
								output: toolResult.output
							}
						}]);
						}

						messages.push({
							role: 'tool',
							tool_call_id: tc.id,
							content: toolResult.output
						});
						if (toolResult.browserImage && shouldAttachDardcorBrowserScreenshot(routerModelCapabilities)) {
							pendingBrowserImages.push(toolResult.browserImage);
						}
						if (token.isCancellationRequested) {
							toolRunInterrupted = true;
							break;
						}
					}
					for (const [index, image] of pendingBrowserImages.entries()) {
						messages.push({
							role: 'user',
							content: [
								{ type: 'text', text: `Visual evidence from integrated browser screenshot ${index + 1}. Use it alongside the preceding DOM snapshot.` },
								{ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }
							]
						});
					}
					if (incompleteNativeToolCalls.length > 0) {
						const message = `The provider stream ended before ${incompleteNativeToolCalls.length} tool call(s) included a function name. Retry those actions using a complete tool call.`;
						messages.push({ role: 'user', content: `[Tool call rejected]: ${message}` });
						if (isTaskCompleted) {
							acceptedTaskCompletion = false;
							completionRejectedReason ||= message;
						}
					}

					if (toolRunBlocked) {
						saveRunState({ status: 'blocked' });
						break;
					}
					if (toolRunInterrupted) {
						saveRunState({ status: 'paused', lastError: 'Run cancelled while a tool action was in progress; inspect that action before retrying.' });
						break;
					}

					if (isTaskCompleted) {
						if (taskIsTracked && acceptedTaskCompletion) {
						const finalDecision = revalidateDardcorCompletion(acceptedTaskCompletion, completionArgs, completionBlocker);
						completionRejectedReason = finalDecision.reason;
						acceptedTaskCompletion = finalDecision.accepted;
						}
						if (taskIsTracked && !acceptedTaskCompletion) {
							const reason = completionRejectedReason || 'The completion request did not pass the task completion gate.';
							const stalledTurns = (runState?.stalledTurns ?? 0) + 1;
							const todos = todoListService?.getTodos(request.sessionResource) ?? [];
							const browserRequirement = reason.startsWith('Browser verification is missing:') && runState
								? getDardcorBrowserVerificationRequirement(activeTaskPrompt, runState)
								: undefined;
							browserVerificationOnly = todos.length > 0 && todos.every(todo => todo.status === 'completed') && !!browserRequirement;
							const nextStep = browserRequirement === 'interaction'
								? 'Use the integrated Browser Editor for one relevant, safe Playwright interaction, then inspect its post-action DOM snapshot.'
								: browserRequirement === 'page-inspection'
									? 'Open the implemented site in the integrated Browser Editor and inspect its rendered DOM snapshot and console diagnostics.'
									: runState?.nextStep;
							saveRunState({ stalledTurns, lastError: reason, nextStep });
							if (stalledTurns >= 3) {
								saveRunState({ status: 'blocked' });
								break;
							}
							messages.push({ role: 'user', content: browserVerificationOnly
								? `[Runtime Browser Gate]: ${reason} Use only the integrated Browser Editor tools now; the runtime will unlock other tools after the required live browser evidence is captured.`
								: `[Completion Gate]: Do not claim completion. ${reason} Continue using tools; update the checklist and collect actual verification evidence.` });
							continue;
						}
						let markerService: IMarkerService | undefined;
						try {
							this.instantiationService.invokeFunction(accessor => {
								try { markerService = accessor.get(IMarkerService); } catch { }
							});
						} catch { }
						if (markerService) {
							const errorMarkers = markerService.read({}).filter(m => m.severity === MarkerSeverity.Error);
							if (errorMarkers.length > 0 && consecutiveTextTurns === 0) {
								const sampleErrors = errorMarkers.slice(0, 5).map(m => {
									const rel = snapshot.rootUri ? m.resource.fsPath.replace(snapshot.rootUri.fsPath, '').replace(/^[\\\/]+/, '') : m.resource.path;
									return `[ERROR] ${rel}:${m.startLineNumber} - ${m.message}`;
								}).join('\n');
								messages.push({
									role: 'user',
									content: `[System Quality Guard]: Task completed was signaled, but the following diagnostic error(s) were detected in the workspace:\n${sampleErrors}\nPlease fix these compilation/syntax errors before concluding.`
								});
								saveRunState({ status: 'working', lastError: `Workspace diagnostics contain ${errorMarkers.length} error(s).` });
								acceptedTaskCompletion = false;
								continue;
							}
						}
						if (taskIsTracked && acceptedTaskCompletion) {
							saveRunState({ status: 'completed', stalledTurns: 0, lastError: undefined });
							if (!finalSynthesisCompleted && !finalSynthesisTurnPending) {
								finalSynthesisTurnPending = true;
								consecutiveTextTurns = 0;
								messages.push({
									role: 'user',
									content: '[Final Summary Mandate]: The task completion verification has PASSED all quality gates, compiler diagnostics, and workspace checks. Now output your final, comprehensive concluding response directly to the user in the user’s detected language (e.g. Indonesian). Structure your response clearly with: 1) Executive Summary of accomplishments and resolved issues, 2) Complete list of files created or modified with their specific roles, 3) Verification evidence (terminal tests, compiler diagnostics showing 0 errors, live browser verification), 4) Clear, step-by-step instructions for the user on how to run, test, and use the project. Do not call any further tools; output only your polished final Markdown report.'
								});
								continue;
							}
						}
						break;
					}

					continue;
				} else if (textToolCalls.length > 0) {
					if (finalSynthesisTurnPending) {
						finalSynthesisCompleted = true;
						finalSynthesisTurnPending = false;
						saveRunState({ status: 'completed', stalledTurns: 0, lastError: undefined });
						break;
					}
					consecutiveTextTurns = 0;
					const isTaskCompleted = textToolCalls.some(tc => tc.name === 'task_completed' || tc.name === 'complete_task');
					let completionRejectedReason: string | undefined;
					let completionArgs: any;
					let toolRunBlocked = false;
					let toolRunInterrupted = false;
					messages.push({
						role: 'assistant',
						content: streamedAssistantText
					});

					for (const tc of textToolCalls) {
						const toolArgs: any = tc.args ?? {};
						const filePath = extractAgentFilePath(toolArgs);
						if (filePath && !toolArgs.filePath) {
							toolArgs.filePath = filePath;
						}

						let targetUri: URI | undefined;
						if (['write_file', 'edit_file', 'delete_file'].includes(tc.name) && filePath) {
							targetUri = resolveAgentUri(filePath, snapshot.rootUri);
						}

						const callId = `text_call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

						if (chatEditingService && targetUri) {
							chatEditingService.setSessionRunning?.(request.sessionResource, true, [targetUri]);
						}

						let toolResult: { output: string; executionStatus?: AgentToolExecutionStatus; browserImage?: { mimeType: 'image/png'; base64: string }; nativeToolInvocation?: boolean; externalEdit?: { uri: URI; editKind: 'create' | 'edit' | 'delete'; initialContent?: string; diff: { added: number; removed: number } } };
						if (tc.parseError) {
							toolResult = { output: `Tool call rejected: ${tc.parseError}`, executionStatus: 'rejected' };
						} else if (tc.name === 'task_completed' && (completionRejectedReason = completionBlocker(toolArgs))) {
							toolResult = { output: `Completion request rejected: ${completionRejectedReason}`, executionStatus: 'rejected' };
						} else {
							if (tc.name === 'task_completed' || tc.name === 'complete_task') {
								acceptedTaskCompletion = true;
								completionArgs = toolArgs;
								proposedCompletionSummary = typeof toolArgs?.summary === 'string' ? toolArgs.summary : undefined;
							}
							toolResult = await executeRouterToolThroughRuntime(tc.name, toolArgs, callId) as typeof toolResult;
						}
						if ((tc.name === 'task_completed' || tc.name === 'complete_task') && acceptedTaskCompletion) {
							const completionSummary = (typeof toolArgs?.summary === 'string' ? toolArgs.summary : '').trim();
							if (completionSummary.length >= 280) {
								progress([{
									kind: 'markdownContent',
									content: new MarkdownString(`\n\n${completionSummary}\n\n`)
								}]);
								taskConclusionSummaryEmitted = true;
								finalSynthesisCompleted = true;
							}
						}
						recordToolEvidence(tc.name, toolArgs, toolResult.output, toolResult.externalEdit, toolResult.executionStatus);
						if (noteToolFailure(toolResult.output, toolResult.executionStatus)) {
							if (isFullAccessActive() && autonomousRecoveryAttempts < MAX_AUTONOMOUS_RECOVERY_ATTEMPTS) {
								autonomousRecoveryAttempts++;
								consecutiveToolFailures = 0;
								toolRunBlocked = false;
								const errorPreview = toolResult.output.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
								const userLang = detectDardcorLanguage(activeTaskPrompt);
								messages.push({
									role: 'user',
									content: getDardcorAutonomousSelfCorrectionDirective(userLang, errorPreview)
								});
							} else {
								toolRunBlocked = true;
								saveRunState({ status: 'blocked', lastError: toolResult.output.slice(0, 500) });
							}
						}

						if (chatEditingService) {
							chatEditingService.setSessionRunning?.(request.sessionResource, false, []);
							if (toolResult.externalEdit) {
								await chatEditingService.registerFileEdit?.(
									request.sessionResource,
									toolResult.externalEdit.uri,
									toolResult.externalEdit.editKind,
									toolResult.externalEdit.initialContent,
									request.requestId,
									callId,
									toolResult.externalEdit.diff
								);
							}
						}

						const display = this._getToolDisplayInfo(tc.name, toolArgs);

						if (toolResult.externalEdit) {
							progress([{
								kind: 'externalEdit',
								uri: toolResult.externalEdit.uri,
								editKind: toolResult.externalEdit.editKind,
								diff: toolResult.externalEdit.diff,
								undoStopId: callId
							}]);
						}

						if (!toolResult.nativeToolInvocation) {
						progress([{
							kind: 'toolInvocationSerialized',
							toolCallId: callId,
							toolId: tc.name,
							source: ToolDataSource.Internal,
							invocationMessage: new MarkdownString(display.invocationMessage),
							originMessage: undefined,
							pastTenseMessage: new MarkdownString(display.pastTenseMessage),
							isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
							isComplete: true,
							presentation: (toolResult.externalEdit || tc.name === 'task_completed' || tc.name === 'complete_task' || tc.name === 'review_plan') ? ToolInvocationPresentation.Hidden : undefined,
							toolSpecificData: (tc.name === 'run_command' || tc.name === 'run_in_terminal' || tc.name === 'confirm_terminal_command') ? {
								kind: 'terminal',
								commandLine: {
									original: (toolArgs?.command || toolArgs?.commandLine || ''),
									forDisplay: (toolArgs?.command || toolArgs?.commandLine || '')
								},
								language: isWindows ? 'powershell' : 'sh',
								terminalCommandOutput: {
									text: toolResult.output,
									lineCount: (toolResult.output || '').split('\n').length
								},
								terminalCommandState: {
									exitCode: parseAgentCommandExitCode(toolResult.output),
									timestamp: Date.now()
								}
							} : {
								kind: 'simpleToolInvocation',
								input: display.formattedInput,
								output: toolResult.output
							}
						}]);
						}

						const toolResultText = `[Tool Execution Result for ${tc.name}]:\n${toolResult.output}`;
						messages.push({
							role: 'user',
							content: toolResult.browserImage && shouldAttachDardcorBrowserScreenshot(routerModelCapabilities)
								? [
									{ type: 'text', text: toolResultText },
									{ type: 'image_url', image_url: { url: `data:${toolResult.browserImage.mimeType};base64,${toolResult.browserImage.base64}` } }
								]
								: toolResultText
						});
						if (token.isCancellationRequested) {
							toolRunInterrupted = true;
							break;
						}
					}

					if (toolRunBlocked) {
						saveRunState({ status: 'blocked' });
						break;
					}
					if (toolRunInterrupted) {
						saveRunState({ status: 'paused', lastError: 'Run cancelled while a tool action was in progress; inspect that action before retrying.' });
						break;
					}

					if (isTaskCompleted) {
						if (taskIsTracked && acceptedTaskCompletion) {
						const finalDecision = revalidateDardcorCompletion(acceptedTaskCompletion, completionArgs, completionBlocker);
						completionRejectedReason = finalDecision.reason;
						acceptedTaskCompletion = finalDecision.accepted;
						}
						if (taskIsTracked && !acceptedTaskCompletion) {
							const reason = completionRejectedReason || 'The completion request did not pass the task completion gate.';
							const stalledTurns = (runState?.stalledTurns ?? 0) + 1;
							const todos = todoListService?.getTodos(request.sessionResource) ?? [];
							const browserRequirement = reason.startsWith('Browser verification is missing:') && runState
								? getDardcorBrowserVerificationRequirement(activeTaskPrompt, runState)
								: undefined;
							browserVerificationOnly = todos.length > 0 && todos.every(todo => todo.status === 'completed') && !!browserRequirement;
							const nextStep = browserRequirement === 'interaction'
								? 'Use the integrated Browser Editor for one relevant, safe Playwright interaction, then inspect its post-action DOM snapshot.'
								: browserRequirement === 'page-inspection'
									? 'Open the implemented site in the integrated Browser Editor and inspect its rendered DOM snapshot and console diagnostics.'
									: runState?.nextStep;
							saveRunState({ stalledTurns, lastError: reason, nextStep });
							if (stalledTurns >= 3) {
								saveRunState({ status: 'blocked' });
								break;
							}
							messages.push({ role: 'user', content: browserVerificationOnly
								? `[Runtime Browser Gate]: ${reason} Use only the integrated Browser Editor tools now; the runtime will unlock other tools after the required live browser evidence is captured.`
								: `[Completion Gate]: Do not claim completion. ${reason} Continue using tools; update the checklist and collect actual verification evidence.` });
							continue;
						}
						let markerService: IMarkerService | undefined;
						try {
							this.instantiationService.invokeFunction(accessor => {
								try { markerService = accessor.get(IMarkerService); } catch { }
							});
						} catch { }
						if (markerService) {
							const errorMarkers = markerService.read({}).filter(m => m.severity === MarkerSeverity.Error);
							if (errorMarkers.length > 0 && consecutiveTextTurns === 0) {
								const sampleErrors = errorMarkers.slice(0, 5).map(m => {
									const rel = snapshot.rootUri ? m.resource.fsPath.replace(snapshot.rootUri.fsPath, '').replace(/^[\\\/]+/, '') : m.resource.path;
									return `[ERROR] ${rel}:${m.startLineNumber} - ${m.message}`;
								}).join('\n');
								messages.push({
									role: 'user',
									content: `[System Quality Guard]: Task completed was signaled, but the following diagnostic error(s) were detected in the workspace:\n${sampleErrors}\nPlease fix these compilation/syntax errors before concluding.`
								});
								saveRunState({ status: 'working', lastError: `Workspace diagnostics contain ${errorMarkers.length} error(s).` });
								acceptedTaskCompletion = false;
								continue;
							}
						}
						if (taskIsTracked && acceptedTaskCompletion) {
							saveRunState({ status: 'completed', stalledTurns: 0, lastError: undefined });
							if (!finalSynthesisCompleted && !finalSynthesisTurnPending) {
								finalSynthesisTurnPending = true;
								consecutiveTextTurns = 0;
								messages.push({
									role: 'user',
									content: '[Final Summary Mandate]: The task completion verification has PASSED all quality gates, compiler diagnostics, and workspace checks. Now output your final, comprehensive concluding response directly to the user in the user’s detected language (e.g. Indonesian). Structure your response clearly with: 1) Executive Summary of accomplishments and resolved issues, 2) Complete list of files created or modified with their specific roles, 3) Verification evidence (terminal tests, compiler diagnostics showing 0 errors, live browser verification), 4) Clear, step-by-step instructions for the user on how to run, test, and use the project. Do not call any further tools; output only your polished final Markdown report.'
								});
								continue;
							}
						}
						break;
					}

					continue;
				}

				if (taskIsTracked || hasIncompleteLoopTodos) {
					if (finalSynthesisTurnPending) {
						finalSynthesisCompleted = true;
						finalSynthesisTurnPending = false;
						acceptedTaskCompletion = true;
						taskConclusionSummaryEmitted = true;
						if (assistantTextRoutedToThinking && streamedAssistantText.trim().length > 0 && !isInternalThinkingMonologue(streamedAssistantText)) {
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(streamedAssistantText.trim())
							}]);
						}
						messages.push({ role: 'assistant', content: streamedAssistantText });
						saveRunState({ status: 'completed', stalledTurns: 0, lastError: undefined });
						break;
					}

					const allTodos = todoListService?.getTodos(request.sessionResource) ?? [];
					const incompleteTodos = allTodos.filter(t => t.status !== 'completed');

					// Case A: Unfinished checklist items exist (e.g. 5/8 todos) - Agent MUST NOT STOP!
					if (incompleteTodos.length > 0 && !token.isCancellationRequested) {
						consecutiveTextTurns++;
						if (consecutiveTextTurns <= 24) {
							const nextItem = incompleteTodos[0];
							const userLang = detectDardcorLanguage(activeTaskPrompt);
							messages.push({
								role: 'assistant',
								content: streamedAssistantText || streamedReasoningText.trim() || 'Continuing task execution...'
							});
							const isMonologue = isInternalThinkingMonologue(streamedAssistantText);
							const directive = isMonologue
								? (userLang === 'id'
									? `[System Autonomous Guard]: Anda menuliskan rencana pemikiran internal ("${streamedAssistantText.slice(0, 150)}...") tetapi belum memanggil tool. Tugas "${nextItem.title}" belum selesai (${allTodos.length - incompleteTodos.length}/${allTodos.length} selesai). Anda WAJIB langsung mengeksekusi tool (write_file, edit_file, run_command, dll.) sekarang tanpa menunda.`
									: `[System Autonomous Guard]: You outputted internal scratchpad thoughts ("${streamedAssistantText.slice(0, 150)}...") but did NOT invoke a tool. Task "${nextItem.title}" is still unfinished (${allTodos.length - incompleteTodos.length}/${allTodos.length} done). You MUST invoke an action tool (write_file, edit_file, run_command, etc.) right now to perform the implementation.`)
								: getDardcorAutonomousMomentumDirective(userLang, allTodos.length - incompleteTodos.length, allTodos.length, nextItem);
							messages.push({
								role: 'user',
								content: directive
							});
							if (consecutiveTextTurns >= 2 && !supportsNativeTools) {
								addDynamicFallbackTools();
							}
							continue;
						}
						const reason = `The agent paused after ${consecutiveTextTurns} consecutive steps on checklist item: "${incompleteTodos[0].title}".`;
						saveRunState({ status: 'paused', lastError: reason, nextStep: `Resume checklist item: ${incompleteTodos[0].title}` });
						break;
					}

					// Case B: All checklist items completed (8/8) - Antigravity-Style Final Synthesis
					if (allTodos.length > 0 && incompleteTodos.length === 0 && !token.isCancellationRequested) {
						let markerService: IMarkerService | undefined;
						try {
							this.instantiationService.invokeFunction(accessor => {
								try { markerService = accessor.get(IMarkerService); } catch { }
							});
						} catch { }
						const errorMarkers = markerService?.read({}).filter(m => m.severity === MarkerSeverity.Error) ?? [];
						if (errorMarkers.length > 0 && consecutiveTextTurns === 0) {
							const sampleErrors = errorMarkers.slice(0, 5).map(m => {
								const rel = snapshot.rootUri ? m.resource.fsPath.replace(snapshot.rootUri.fsPath, '').replace(/^[\\\/]+/, '') : m.resource.path;
								return `[ERROR] ${rel}:${m.startLineNumber} - ${m.message}`;
							}).join('\n');
							messages.push({
								role: 'user',
								content: `[System Quality Guard]: All checklist items are marked complete, but the following diagnostic error(s) remain in the workspace:\n${sampleErrors}\nPlease fix these compilation/syntax errors before concluding.`
							});
							saveRunState({ status: 'working', lastError: `Workspace diagnostics contain ${errorMarkers.length} error(s).` });
							continue;
						}

						if (streamedAssistantText.trim().length >= 250 && errorMarkers.length === 0 && !isInternalThinkingMonologue(streamedAssistantText)) {
							if (assistantTextRoutedToThinking) {
								progress([{
									kind: 'markdownContent',
									content: new MarkdownString(streamedAssistantText.trim())
								}]);
							}
							acceptedTaskCompletion = true;
							finalSynthesisCompleted = true;
							taskConclusionSummaryEmitted = true;
							messages.push({ role: 'assistant', content: streamedAssistantText });
							saveRunState({ status: 'completed', stalledTurns: 0, lastError: undefined });
							break;
						}

						if (!finalSynthesisCompleted && !finalSynthesisTurnPending) {
							finalSynthesisTurnPending = true;
							consecutiveTextTurns = 0;
							messages.push({ role: 'assistant', content: streamedAssistantText || 'All checklist items completed.' });
							const userLang = detectDardcorLanguage(activeTaskPrompt);
							const summaryMandate = userLang === 'id'
								? '[Final Summary Mandate]: Semua item checklist telah 100% SELESAI dan diverifikasi tanpa error diagnostik. Sekarang berikan laporan kesimpulan akhir yang sangat lengkap, elegan, dan profesional langsung kepada pengguna (seperti Google Antigravity). Format laporan akhir:\n1) **Ringkasan Eksekutif**: Apa saja yang telah diselesaikan secara tuntas.\n2) **Daftar Lengkap File & Komponen**: Semua file yang dibuat atau dimodifikasi beserta perannya.\n3) **Bukti Verifikasi**: Hasil pengujian, pemeriksaan diagnostik (0 error), dan konfirmasi kelengkapan.\n4) **Panduan Menjalankan & Menguji**: Langkah praktis dan jelas bagi pengguna untuk menjalankan/menguji hasil pekerjaan.\nJangan panggil tools lagi; tuliskan laporan kesimpulan Markdown yang sangat rapi dan lengkap sekarang.'
								: '[Final Summary Mandate]: All checklist items are 100% COMPLETED and verified with 0 diagnostic errors. Now provide a comprehensive, elegant, and professional final report directly to the user (Antigravity-style). Structure:\n1) **Executive Summary**: Overview of accomplishments and resolved issues.\n2) **Files Created & Modified**: Complete list of files with their roles.\n3) **Verification Evidence**: Test results and zero-error diagnostic confirmation.\n4) **Usage & Testing Guide**: Clear instructions for the user on how to run and use the project.\nDo not call any further tools; output only your polished final Markdown report.';
							messages.push({
								role: 'user',
								content: summaryMandate
							});
							continue;
						}
					}

					// Case C: Standard tracked conversation without active checklist
					consecutiveTextTurns++;
					const textTurnLimit = browserVerificationOnly ? 2 : MAX_CONSECUTIVE_TEXT_TURNS;
					if (getDardcorPlainTextTurnDecision(taskIsTracked, consecutiveTextTurns, textTurnLimit, incompleteTodos.length > 0) === 'continue' && !token.isCancellationRequested) {
						messages.push({ role: 'assistant', content: streamedAssistantText });
						const currentRunState = runState;
						const currentVerificationEvidence = currentRunState
							? currentRunState.verificationEvidence.filter(item => item.workspaceRevision === currentRunState.workspaceRevision).map(item => item.message).join(' | ') || 'none'
							: 'none';
						messages.push({
							role: 'user',
							content: browserVerificationOnly
								? `[Runtime Browser Gate]: No browser tool call was produced. Use an enabled integrated Browser Editor tool now. Do not use terminal or HTTP as a substitute for live page evidence.`
								: `[Agent Workflow Guard]: The task is still ${currentRunState?.status ?? 'working'} and is not complete. Your last response contained conversational text without an action tool call. You MUST immediately take action by invoking one of the available tools (e.g. write_file, edit_file, run_command, or manage_todo_list). Checklist=${JSON.stringify(allTodos)}. Current verification evidence=${currentVerificationEvidence}. Do NOT output conversational apologies or planning text in user chat without calling a tool; invoke an action tool call NOW.`
						});
						continue;
					}
					const reason = token.isCancellationRequested
						? 'The user cancelled the run before all checklist items and verification were complete.'
						: `The model returned ${consecutiveTextTurns} consecutive responses without a valid action tool call.`;
					saveRunState({ status: token.isCancellationRequested ? 'paused' : 'blocked', lastError: reason });
					break;
				}

				if (isPlanMode) {
					if (!planOpenedInEditor && streamedAssistantText && fileService && pathService) {
						try {
							const userHome = await pathService.userHome();
							const memoryDir = joinPath(userHome, '.dardcor', 'memory', 'plans');
							if (!await fileService.exists(memoryDir)) {
								await fileService.createFolder(memoryDir);
							}
							const slug = 'plan-' + Date.now().toString(36);
							const planUri = joinPath(memoryDir, `${slug}.md`);
							await fileService.writeFile(planUri, VSBuffer.fromString(streamedAssistantText));
							openPlanPreview(planUri).catch(err => {
								console.warn('[streamDardcorRouter] Failed to auto-open streamed plan in center editor:', err);
							});
						} catch (err) {
							console.warn('[streamDardcorRouter] Failed to auto-open streamed plan in center editor:', err);
						}
					}
					break;
				}

				const shouldContinue = this._shouldAgentContinueAutonomousLoop(currentPrompt, streamedAssistantText, turn);
				if (shouldContinue && consecutiveTextTurns < MAX_CONSECUTIVE_TEXT_TURNS) {
					consecutiveTextTurns++;
					messages.push({
						role: 'assistant',
						content: streamedAssistantText
					});
					messages.push({
						role: 'user',
						content: '[System Directive]: You provided conversational text without invoking an action tool. If all project files, components, views, styles, and requirements are 100% complete and verified, call "task_completed" with your final summary. Otherwise, proceed immediately with the next implementation step using your tools (write_file, edit_file, run_command, etc.). Do not stop until all components are created.'
					});
					continue;
				}

				break;
			}

			if (taskIsTracked && !acceptedTaskCompletion && runState && !['blocked', 'paused', 'cancelled', 'completed'].includes(runState.status)) {
				const reason = token.isCancellationRequested
					? 'The user cancelled the run before the completion gate passed.'
					: runState.lastError || 'The agent stopped before the completion gate passed.';
				let stalledTurns = runState.stalledTurns ?? 0;
				if (turnSuccessfulToolActions === 0 && turnFileMutations === 0 && !token.isCancellationRequested) {
					stalledTurns += 1;
				} else if (turnSuccessfulToolActions > 0 || turnFileMutations > 0) {
					stalledTurns = 0;
				}
				if (stalledTurns >= 2) {
					turnEncounteredFatalModelError = true;
					saveRunState({ status: 'blocked', stalledTurns, lastError: 'The agent completed consecutive turns without making observable progress on files or tools.', nextStep: 'Review the checklist, switch model if needed, then resume.' });
				} else {
					saveRunState({ status: 'paused', stalledTurns, lastError: reason, nextStep: runState.nextStep || 'Resume from the first incomplete checklist item.' });
				}
			}

			return {};
		} catch (e: any) {
			turnEncounteredFatalModelError = true;
			const errorMsg = formatAgentToolError(e ?? 'Unknown error');
			if (taskIsTracked) {
				saveRunState({ status: token.isCancellationRequested ? 'paused' : 'blocked', lastError: errorMsg });
			}
			console.error('[streamDardcorRouter] Agent turn error:', e);
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(formatDardcorRouterError(0, errorMsg, modelName))
			}]);
			return {};
		} finally {
			try {
				emitTaskConclusion();
			} catch (error) {
				console.warn('[streamDardcorRouter] Could not emit the final task summary:', error);
			}
		}
	}

	setRequestTools(id: string, requestId: string, tools: UserSelectedTools): void {
		const data = this._agents.get(id);
		if (!data?.impl) {
			return;
		}

		data.impl.setRequestTools?.(requestId, tools);
	}

	setYieldRequested(id: string, requestId: string, value: boolean): void {
		const data = this._agents.get(id);
		if (!data?.impl) {
			return;
		}

		data.impl.setYieldRequested?.(requestId, value);
	}

	async getFollowups(id: string, request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]> {
		const data = this._agents.get(id);
		if (!data?.impl?.provideFollowups) {
			return [];
		}

		return data.impl.provideFollowups(request, result, history, token);
	}

	async getChatTitle(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined> {
		const data = this._agents.get(id);
		if (!data?.impl?.provideChatTitle) {
			return undefined;
		}

		return data.impl.provideChatTitle(history, token);
	}

	async getChatSummary(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined> {
		const data = this._agents.get(id);
		if (!data?.impl?.provideChatSummary) {
			return undefined;
		}

		return data.impl.provideChatSummary(history, token);
	}

	registerChatParticipantDetectionProvider(handle: number, provider: IChatParticipantDetectionProvider) {
		this._chatParticipantDetectionProviders.set(handle, provider);
		return toDisposable(() => {
			this._chatParticipantDetectionProviders.delete(handle);
		});
	}

	hasChatParticipantDetectionProviders() {
		return this._chatParticipantDetectionProviders.size > 0;
	}

	async detectAgentOrCommand(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], options: { location: ChatAgentLocation }, token: CancellationToken): Promise<{ agent: IChatAgentData; command?: IChatAgentCommand } | undefined> {
		const provider = Iterable.first(this._chatParticipantDetectionProviders.values());
		if (!provider) {
			return;
		}

		const participants = this.getAgents().reduce<IChatParticipantMetadata[]>((acc, a) => {
			if (a.locations.includes(options.location)) {
				acc.push({ participant: a.id, disambiguation: a.disambiguation ?? [] });
				for (const command of a.slashCommands) {
					acc.push({ participant: a.id, command: command.name, disambiguation: command.disambiguation ?? [] });
				}
			}
			return acc;
		}, []);

		const result = await provider.provideParticipantDetection(request, history, { ...options, participants }, token);
		if (!result) {
			return;
		}

		const agent = this.getAgent(result.participant);
		if (!agent) {
			return;
		}

		if (!result.command) {
			return { agent };
		}

		const command = agent?.slashCommands.find(c => c.name === result.command);
		if (!command) {
			return;
		}

		return { agent, command };
	}
}

export class MergedChatAgent implements IChatAgent {
	constructor(
		private readonly data: IChatAgentData,
		private readonly impl: IChatAgentImplementation
	) { }
	when?: string | undefined;
	publisherDisplayName?: string | undefined;
	isDynamic?: boolean | undefined;

	get id(): string { return this.data.id; }
	get name(): string { return this.data.name ?? ''; }
	get fullName(): string { return this.data.fullName ?? ''; }
	get description(): string { return this.data.description ?? ''; }
	get extensionId(): ExtensionIdentifier { return this.data.extensionId; }
	get extensionVersion(): string | undefined { return this.data.extensionVersion; }
	get extensionPublisherId(): string { return this.data.extensionPublisherId; }
	get extensionPublisherDisplayName() { return this.data.publisherDisplayName; }
	get extensionDisplayName(): string { return this.data.extensionDisplayName; }
	get isDefault(): boolean | undefined { return this.data.isDefault; }
	get isCore(): boolean | undefined { return this.data.isCore; }
	get metadata(): IChatAgentMetadata { return this.data.metadata; }
	get slashCommands(): IChatAgentCommand[] { return this.data.slashCommands; }
	get locations(): ChatAgentLocation[] { return this.data.locations; }
	get modes(): ChatModeKind[] { return this.data.modes; }
	get disambiguation(): { category: string; description: string; examples: string[] }[] { return this.data.disambiguation; }

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		return this.impl.invoke(request, progress, history, token);
	}

	setRequestTools(requestId: string, tools: UserSelectedTools): void {
		this.impl.setRequestTools?.(requestId, tools);
	}

	setYieldRequested(requestId: string, value: boolean): void {
		this.impl.setYieldRequested?.(requestId, value);
	}

	async provideFollowups(request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]> {
		if (this.impl.provideFollowups) {
			return this.impl.provideFollowups(request, result, history, token);
		}

		return [];
	}

	toJSON(): IChatAgentData {
		return this.data;
	}
}

export const IChatAgentNameService = createDecorator<IChatAgentNameService>('chatAgentNameService');

export interface IChatAgentNameService {
	_serviceBrand: undefined;
	getAgentNameRestriction(chatAgentData: IChatAgentData): boolean;
}

export class ChatAgentNameService implements IChatAgentNameService {

	declare _serviceBrand: undefined;

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
	}

	getAgentNameRestriction(chatAgentData: IChatAgentData): boolean {
		if (chatAgentData.isCore) {
			return true;
		}

		const nameAllowed = this.checkAgentNameRestriction(chatAgentData.name, chatAgentData).get();
		const fullNameAllowed = !chatAgentData.fullName || this.checkAgentNameRestriction(chatAgentData.fullName.replace(/\s/g, ''), chatAgentData).get();
		return nameAllowed && fullNameAllowed;
	}

	private checkAgentNameRestriction(name: string, chatAgentData: IChatAgentData): IObservable<boolean> {
		const allowList = this.languageModelsService.restrictedChatParticipants.map<string[] | undefined>(registry => registry[name.toLowerCase()]);
		return allowList.map(allowList => {
			if (!allowList) {
				return true;
			}

			return allowList.some(id => equalsIgnoreCase(id, id.includes('.') ? chatAgentData.extensionId.value : chatAgentData.extensionPublisherId));
		});
	}
}

export function getFullyQualifiedId(chatAgentData: IChatAgentData): string {
	return `${chatAgentData?.extensionId?.value ?? ''}.${chatAgentData?.id ?? ''}`;
}

interface IOldSerializedChatAgentData extends Omit<ISerializableChatAgentData, 'name'> {
	id: string;
	extensionPublisher?: string;
}

function isSerializableChatAgentData(obj: ISerializableChatAgentData | IOldSerializedChatAgentData | any): obj is ISerializableChatAgentData {
	return obj && (obj as ISerializableChatAgentData).name !== undefined;
}

export function reviveSerializedAgent(raw: ISerializableChatAgentData | IOldSerializedChatAgentData | any): IChatAgentData {
	if (!raw) {
		raw = { id: '', extensionId: { value: '' }, extensionPublisherId: '', extensionName: '' };
	}
	const normalized: ISerializableChatAgentData = isSerializableChatAgentData(raw) ?
		raw :
		{
			...raw,
			name: raw.id || '',
		};

	if (!normalized.extensionPublisherId) {
		normalized.extensionPublisherId = (raw as IOldSerializedChatAgentData).extensionPublisher ?? '';
	}

	if (!normalized.extensionDisplayName) {
		normalized.extensionDisplayName = '';
	}

	if (!normalized.extensionId) {
		normalized.extensionId = new ExtensionIdentifier('');
	}

	return revive(normalized);
}
