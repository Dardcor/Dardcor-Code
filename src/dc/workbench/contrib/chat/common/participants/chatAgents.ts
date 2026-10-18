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
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { revive, Revived } from '../../../../../base/common/marshalling.js';
import { IObservable } from '../../../../../base/common/observable.js';
import { equalsIgnoreCase } from '../../../../../base/common/strings.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { Command } from '../../../../../editor/common/languages.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { basename, dirname, extUriBiasedIgnorePathCase, joinPath } from '../../../../../base/common/resources.js';
import { EditorResourceAccessor } from '../../../../common/editor.js';
import { ChatContextKeys } from '../actions/chatContextKeys.js';
import type { IChatAgentEditedFileEvent, IChatProgressHistoryResponseContent, IChatRequestModeInstructions, IChatRequestVariableData, ISerializableChatAgentData } from '../model/chatModel.js';
import { IChatEditingService } from '../editing/chatEditingService.js';
import { ICustomizationHarnessService } from '../customizationHarnessService.js';
import { ChatRequestHooks } from '../promptSyntax/hookSchema.js';
import { IRawChatCommandContribution } from './chatParticipantContribTypes.js';
import { IChatFollowup, IChatLocationData, IChatProgress, IChatQuestion as IChatCarouselQuestion, IChatQuestionAnswers, IChatResponseErrorDetails, IChatService, IChatTaskDto, ToolConfirmKind } from '../chatService/chatService.js';
import { ILanguageModelToolsService, ToolDataSource, ToolInvocationPresentation, toolContentToA11yString } from '../tools/languageModelToolsService.js';
import type { IToolData } from '../tools/languageModelToolsService.js';
import type { IArtifactRuleOverrides, IChatArtifact } from '../tools/chatArtifactsService.js';
import { IChatArtifactsService } from '../tools/chatArtifactsServiceId.js';
import { TerminalToolId } from '../tools/terminalToolIds.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, ChatPermissionLevel } from '../constants.js';
import { ILanguageModelsService } from '../languageModels.js';
import { ChatPerfMark, markChat } from '../chatPerf.js';
import { IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { formatDardcorRouterError } from './dardcorRouterError.js';
import { ChatQuestionCarouselData } from '../model/chatProgressTypes/chatQuestionCarouselData.js';
import { ChatPlanReviewData } from '../model/chatProgressTypes/chatPlanReviewData.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITaskService } from '../../../tasks/common/taskService.js';
import { IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { IChatTodoListService } from '../tools/chatTodoListService.js';
import { createChatAgentRunState, IChatAgentRunState, IChatAgentRunStateService, updateChatAgentRunState } from '../tools/agentRunStateService.js';
import { commandApprovalKey, getDardcorBrowserVerificationRequirement, getDardcorCompletionBlocker, getDardcorEffectivePermissionLevel, getDardcorPlainTextTurnDecision, getDardcorRunGuardReason, getDardcorToolFailureState, getDardcorVerificationCommandStatus, isDardcorAutonomousTask, isDardcorBrowserTest, isDardcorContinuation, isDardcorLowRiskCommand, parseDardcorAgentToolArguments, requiresDardcorToolConfirmation, revalidateDardcorCompletion, summarizeDardcorToolAction } from './dardcorAgentRunPolicy.js';
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

const ROUTER_PORT = 25128;
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

async function fetchRouter(path: string, init?: RequestInit, retries = 8, timeoutMs = 30000): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < retries; attempt++) {
		for (const host of ROUTER_HOSTS) {
			const url = `http://${host}:${ROUTER_PORT}${path}`;
			let timeoutId: any;
			try {
				let signal = init?.signal;
				if (!signal && timeoutMs > 0) {
					const controller = new AbortController();
					timeoutId = setTimeout(() => {
						try { controller.abort(); } catch { }
					}, timeoutMs);
					signal = controller.signal;
				}
				const res = await fetch(url, { ...init, signal });
				if (timeoutId) clearTimeout(timeoutId);
				return res;
			} catch (err) {
				if (timeoutId) clearTimeout(timeoutId);
				lastErr = err;
			}
		}
		if (attempt < retries - 1) {
			const delay = Math.min(500 + attempt * 300, 2000);
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
					elementId: { type: 'string', description: 'Set-of-Mark numeric ID from read_browser_page (e.g. "3" for [3]) or DOM id' },
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
					elementId: { type: 'string', description: 'Set-of-Mark numeric ID from read_browser_page (e.g. "2" for [2]) or DOM id' },
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
					elementId: { type: 'string', description: 'Optional Set-of-Mark numeric ID of an element to scroll into view' },
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
					elementId: { type: 'string', description: 'Set-of-Mark numeric ID from read_browser_page (e.g. "5")' },
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
					elementId: { type: 'string', description: 'Set-of-Mark numeric ID of the <select> element' },
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
					sourceElementId: { type: 'string', description: 'Set-of-Mark ID of the element to drag' },
					sourceSelector: { type: 'string', description: 'CSS selector or text of the element to drag' },
					targetElementId: { type: 'string', description: 'Set-of-Mark ID of the drop target element' },
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

export function buildDardcorSystemPrompt(snapshot: IWorkspaceSnapshot): string {
	const browserContextLine = snapshot.openBrowserPages && snapshot.openBrowserPages.length > 0
		? `\n- Active Integrated Browser Tabs:\n${snapshot.openBrowserPages.map((p, i) => `  [${i + 1}] ${p}`).join('\n')}`
		: '\n- Active Integrated Browser Tabs: None currently open (use `open_browser_page` to launch one)';

	return `You are Dardcor Code, an elite, state-of-the-art AI Software Engineer built directly into the Dardcor Code Editor.
Always identify yourself as Dardcor Code when asked who you are, what model or AI you are, or your identity. You were created by Dardcor.
Never state that you are Provider, OpenAI, Anthropic, Claude, or any third-party model.
Assist developers with coding, debugging, architecture, refactoring, and software development with precision, depth, and proactivity.
Language Detection & Multilingual Support: Automatically detect the user's language and respond fluently and naturally in the exact same language (e.g. Bahasa Indonesia if the user speaks Indonesian, English if in English, Japanese if in Japanese, etc.). Never force English when the user communicates in another language. Technical code syntax, file paths, and identifiers should remain in their standard technical format, while greetings, explanations, reasoning, and summaries must match the user's detected language.

=== ACTIVE WORKSPACE PROJECT CONTEXT ===
${snapshot.hasWorkspace ? `
- Project Name: ${snapshot.projectName}
- Root Path: ${snapshot.rootPath}
- Tech Stack & Metadata: ${snapshot.techStack}
- Active Open File in Editor: ${snapshot.activeFile || 'None currently open'}${browserContextLine}
${snapshot.activeFileExcerpt ? `\n--- Excerpt of Active File (${snapshot.activeFile}) ---\n${snapshot.activeFileExcerpt}\n--- End Excerpt ---\n` : ''}
- Project Structure & Files:
${snapshot.fileTree || 'No files found'}
` : `- No folder is currently open in the workspace.${browserContextLine}`}

=== AUTONOMOUS AGENTIC CAPABILITIES ===
You have built-in workspace, terminal, network, and integrated-browser tools. Tool availability is not authorization: the active session access level and organization policy are enforced before each action.
- **Ask for approval**: read-only inspection may proceed; actions that change files, run terminal commands, access the network, or interact with a website require an explicit one-time approval.
- **Approve for me**: only a strict allowlist of safe inspection and read-only commands proceeds automatically. File changes, side-effecting terminal actions, network access, browser interactions, and uncertain or unrecognized actions require approval.
- **Full access**: the user has explicitly approved agent actions without per-action prompts; managed organization policy can still restrict this level. This permission does not change task continuation or verification requirements.
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
16. read_browser_page(pageId): Scan the active browser tab, indexing all interactive elements with Set-of-Mark IDs [1..N], visible text, scroll state, and console errors.
17. navigate_browser(url, pageId): Navigate the active browser tab to a new URL and return the new DOM snapshot.
18. click_element(elementId, selector, text, x, y, doubleClick): Move the Dardcor cursor to a unique button, link, tab, or coordinate and click it with Playwright.
19. type_in_page(text, elementId, selector, clearFirst, pressEnter): Move the Dardcor cursor to an input/textarea, type with Playwright, and optionally press Enter.
20. scroll_browser_page(direction, amount, selector, elementId): Scroll the browser page (down/up/top/bottom) or scroll to a specific element.
21. hover_element(elementId, selector, text, x, y): Move the Dardcor cursor over an element to trigger hover menus or tooltips.
22. press_key(key): Press keyboard keys ("Enter", "Escape", "Tab", "ArrowDown", "Backspace", etc.) in the browser.
23. select_option(elementId, selector, value, optionText, index): Select an option from a <select> dropdown in the browser.
24. drag_and_drop(sourceElementId, sourceSelector, targetElementId, targetSelector): Drag and drop elements in the browser with the Dardcor cursor.
25. wait_for_browser(selector, text, timeoutMs): Wait for an element, text, or DOM stability in the browser.
26. execute_browser_script(script): Execute custom JavaScript inside the active browser page and inspect the returned result.
27. get_browser_console_logs(pageId): Read console logs, warnings, and runtime JavaScript errors from the browser page.
28. handle_browser_dialog(accept, promptText): Accept or dismiss browser alert/confirm/prompt dialogs.
29. screenshot_browser_page(pageId): Capture a live screenshot and full DOM snapshot of the active browser page.
30. task_completed(summary, verificationSteps, filesChanged): Request completion review. This is only a proposal; runtime checks require completed checklist items and recorded verification evidence.

TOOL CALLING FORMAT:
You can call tools via native tool calling, or if using text formatting:
\`\`\`json:tool
{
  "name": "tool_name",
  "arguments": { ... }
}
\`\`\`
or
<tool_call>
{
  "name": "tool_name",
  "arguments": { ... }
}
</tool_call>

CRITICAL DIRECTIVES:
1. Language matching: Automatically detect the language used by the user and respond in that exact same language across all messages, explanations, questions, and summaries.
2. When asked who you are, greetings, or general questions:
   Respond directly, politely, and warmly in clean Markdown in the user's detected language WITHOUT calling any tools.
   State clearly that you are Dardcor Code, mention the detected active project (${snapshot.projectName}) and its tech stack (${snapshot.techStack}).
3. Only use tools when the user specifically asks you to inspect, search, read, modify, or create files, run commands, or interact with the browser.
4. AUTONOMOUS TASK CONTINUATION & COMPLETION:
   - When tasked with building, creating, continuing, completing, fixing, or modifying code (e.g. creating a website, application, Next.js project, views, components, or fixing bugs):
     * You MUST implement the entire project completely from start to finish.
     * Do NOT stop after only creating root configuration files (like package.json, tsconfig.json, tailwind.config.js).
     * You MUST proceed to implement all necessary source code files in "src/" or "app/" (such as pages, layouts, views, components, styles, utilities).
     * Continue calling tools consecutively turn after turn until all required files are written and the application is fully functional.
     * NEVER stop midway or output transitional conversational text alone (e.g. "Now I will create view X") without immediately calling the tool to create that file in the same turn.
     * Write full, complete, production-ready code with no placeholders.
     * Use get_diagnostics to verify there are no syntax or type errors after making major changes.
     * When all implementation steps and verification are done, call "task_completed" and provide a clear, concise user-facing conclusion in its summary field using the user's language. State what changed and the actual result; do not claim unverified work. The runtime will append checklist and verification evidence to the final report.
5. When modifying files, apply edits accurately and ensure consistency across the project.
6. Terminal command execution:
   - The workspace terminal runs ${isWindows ? 'Windows PowerShell' : 'POSIX Bash/Zsh'}.
   ${isWindows ? '- On Windows: use valid PowerShell syntax. Chain commands with semicolons (;), NEVER use "&&" or "cmd /c". NEVER use Unix bash heredocs (<< EOF). Standard commands like "npm run build", "npm run dev", "node script.js", "git status" work directly.' : '- On POSIX systems: use standard bash/zsh syntax.'}
7. SUPER-INTELLIGENT AUTONOMOUS BROWSER AGENT & LIVE VISUAL CURSOR PROTOCOL:
   - You control a real integrated Chromium browser with the **Dardcor cursor**. Browser actions must target unique locators, wait for Playwright actionability, and inspect the returned post-action DOM snapshot.
   - **Observe First**: If a browser tab is already open (listed under Active Integrated Browser Tabs), call \`read_browser_page\` first to get the Set-of-Mark interactive element map (\`[1]..[N]\`), or call \`open_browser_page\` if no tab is open or a new URL is requested.
   - **Act with Precision**: Use \`click_element\` (passing \`elementId: "N"\`, \`selector\`, or visible \`text\`), \`type_in_page\` (with \`pressEnter: true\` for search boxes/forms), \`scroll_browser_page\` (to inspect content below the fold), \`select_option\`, \`hover_element\`, or \`press_key\`.
   - **Verify & Self-Heal**: Every browser action automatically returns the updated Interactive DOM Snapshot and Console Diagnostics. Always inspect the returned snapshot to verify whether navigation, modal opening, cart update, or form submission succeeded. If any runtime/console error or broken UI behavior is detected, proactively inspect and fix the project source code and re-verify in the browser!
   - Browser verification must use the visible integrated Browser Editor and its Playwright-backed tools. Do not replace a failed browser interaction with HTTP requests, curl, or terminal output and call that a website interaction test. If the tab, cursor, Playwright attachment, action, or post-action snapshot fails, stop that browser verification, report the exact blocker, and leave the task blocked with a concrete retry step.
8. CLEAN WORKSPACE DIRECTIVE:
   - NEVER create a ".vscode" or ".dardcor-code" folder, and NEVER create any "tasks.json" file in the user's project.
   - Keep the project directory completely clean, containing ONLY genuine application files and code.
   - When running builds, installers, package managers, development servers, or background services (such as composer, npm, php artisan, vite, next, cargo, docker), ALWAYS execute them directly via the integrated terminal using "run_command".
9. COMPLETION GATE:
   - For every coding, implementation, debugging, or testing request, create and maintain a complete checklist with manage_todo_list before substantial changes.
   - A plain-text answer, promise, or task_completed call does not prove the work is complete. Finish every checklist item and run relevant verification; report the actual command/results.
   - If a tool, provider, browser, or verification fails, explain the failure and leave the task paused/blocked with the next concrete step. Never describe unfinished work as finished.
   - For browser testing, use the integrated Browser Editor. The visible cursor animation must accompany the real Playwright action; inspect the returned post-action DOM snapshot and surface browser/tool errors.
`;
}

export const DARDCOR_SYSTEM_PROMPT = `You are Dardcor Code, an advanced AI programming assistant developed by Dardcor for the Dardcor Code Editor.
Always identify yourself as Dardcor Code when asked who you are, what model or AI you are, or your identity. You were created by Dardcor.
Never state that you are Provider, or any other third-party model.
Assist developers with coding, debugging, architecture, refactoring, and software development with precision and depth.
Automatically detect the user's language and respond fluently and naturally in the exact same language (e.g. Bahasa Indonesia, English, Japanese, etc.) for all outputs, explanations, reasoning, and summaries. Never respond in English when the user communicates in Indonesian or another language unless explicitly requested.
Never create any .vscode folder or tasks.json files. Keep the user workspace completely clean.`;

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

	public static readonly FULL_THINK_BLOCK_REGEX = /<(?:think|thinking|thought|reasoning|antThinking)(?:\s+[^>]*)?>[\s\S]*?<\/(?:think|thinking|thought|reasoning|antThinking)\s*>|◁think▷[\s\S]*?◁\/think▷|<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>|\[THINK\][\s\S]*?\[\/THINK\]/gi;
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
							if (child.isDirectory) treeLines.push(`${prefix}📁 ${child.name}/`);
							continue;
						}
						if (child.isDirectory) {
							treeLines.push(`${prefix}📁 ${child.name}/`);
							await scan(child.resource, prefix + '  ', depth + 1);
						} else {
							treeLines.push(`${prefix}📄 ${child.name}`);
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
			case 'manage_todo_list': {
				const list = Array.isArray(args?.todoList) ? args.todoList : [];
				return {
					invocationMessage: `Updating task checklist (${list.length} items)`,
					pastTenseMessage: `Updated task checklist (${list.length} items)`,
					formattedInput: JSON.stringify(list, null, 2)
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
				const target = args?.text || args?.selector || (args?.elementId ? `[${args.elementId}]` : '') || (args?.x !== undefined ? `(${args.x}, ${args.y})` : 'element');
				return {
					invocationMessage: `Moving Dardcor cursor & clicking \`${target}\``,
					pastTenseMessage: `Clicked \`${target}\` on browser page`,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'type_in_page':
			case 'type_browser': {
				const target = args?.selector || (args?.elementId ? `[${args.elementId}]` : 'input');
				return {
					invocationMessage: `Typing \`"${args?.text || ''}"\` into \`${target}\``,
					pastTenseMessage: `Typed \`"${args?.text || ''}"\` into \`${target}\``,
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'scroll_browser_page':
			case 'scroll_page': {
				const desc = args?.selector || args?.elementId
					? `to \`${args.selector || `[${args.elementId}]`}\``
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
					pastTenseMessage: 'Completion request submitted for verification',
					formattedInput: typeof args?.summary === 'string' ? args.summary : JSON.stringify(args ?? {}, null, 2)
				};
			}
			default: {
				return {
					invocationMessage: `Executing ${toolName}`,
					pastTenseMessage: `Executed ${toolName}`,
					formattedInput: typeof args === 'string' ? args : JSON.stringify(args ?? {}, null, 2)
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
		if (toolName === 'create_and_run_task') {
			if (!workspaceFolder) {
				return { output: 'Task was not created or run: open a workspace folder first.' };
			}
			const command = String(args?.command ?? args?.task?.command ?? '').trim();
			const label = String(args?.label ?? args?.name ?? args?.task?.label ?? 'Dardcor Agent Task').trim();
			if (!command) {
				return { output: 'Task was not created or run: a non-empty command is required.' };
			}
			return this._invokeBuiltinAgentTool(TerminalToolId.CreateAndRunTask, {
				workspaceFolder,
				task: {
					label,
					type: 'shell',
					command,
					args: Array.isArray(args?.args) ? args.args.map(String) : undefined,
					isBackground: !!args?.isBackground,
					problemMatcher: Array.isArray(args?.problemMatcher) ? args.problemMatcher.map(String) : undefined,
				},
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
			if (!id) {
				return { output: 'Terminal input was not sent: a terminal ID is required.' };
			}
			return this._invokeBuiltinAgentTool(TerminalToolId.SendToTerminal, {
				id,
				command: String(args?.command ?? args?.commandLine ?? args?.text ?? ''),
				waitForOutput: args?.waitForOutput === true,
			}, chatSessionResource, rootUri, requestId, token, approvedByUser);
		}
		if (toolName === 'kill_terminal') {
			const id = String(args?.id ?? args?.terminalId ?? '').trim();
			if (!id) {
				return { output: 'Terminal was not killed: a terminal ID is required.' };
			}
			return this._invokeBuiltinAgentTool(TerminalToolId.KillTerminal, { id }, chatSessionResource, rootUri, requestId, token, approvedByUser);
		}
		if (toolName === 'get_terminal_output') {
			const id = String(args?.id ?? args?.terminalId ?? '').trim();
			if (!id) {
				return { output: 'Terminal output was not read: a terminal ID is required.' };
			}
			return this._invokeBuiltinAgentTool(TerminalToolId.GetTerminalOutput, { id }, chatSessionResource, rootUri, requestId, token);
		}

		switch (toolName) {
			case 'read':
			case 'view_file':
			case 'read_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const targetPath = extractAgentFilePath(args);
				if (!targetPath) return { output: 'Error: Missing filePath parameter.' };
				const target = fileReadResolution?.target ?? resolveUri(targetPath);
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
					let text = initialContent;
					const search = (args?.searchContent ?? '').replace(/\r\n/g, '\n');
					const replace = (args?.replaceContent ?? '').replace(/\r\n/g, '\n');
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
							const ITerminalService = createDecorator<any>('terminalService');
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
								const effectiveCmd = isWin ? cmdTrim.replace(/\s*&&\s*/g, ' ; ') : cmdTrim;
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
											cleanup();
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
									outputMsg = `${cleanOutput || 'Command executed successfully.'}\n[Command result: exit code 0]`;
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
							const ITerminalService = createDecorator<any>('terminalService');
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
							const ITerminalService = createDecorator<any>('terminalService');
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
							const ITerminalService = createDecorator<any>('terminalService');
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
			case 'manage_todo_list': {
				try {
					const list: Array<{ id: number; title: string; status: 'not-started' | 'in-progress' | 'completed' }> = args.todoList || [];
					if (!Array.isArray(list) || list.length === 0) {
						return { output: 'Todo list is empty.' };
					}
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
					todoService.setTodos(chatSessionResource, list);
					const rendered = list.map(item => {
						const icon = item.status === 'completed' ? '[x]' : item.status === 'in-progress' ? '[~]' : '[ ]';
						return `${icon} ${item.id}. ${item.title} (${item.status})`;
					}).join('\n');
					return { output: `Todo checklist updated:\n${rendered}` };
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
						const ITerminalService = createDecorator<any>('terminalService');
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
						const ITerminalService = createDecorator<any>('terminalService');
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
						const ITerminalService = createDecorator<any>('terminalService');
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
									term.show?.();
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
						const ITerminalService = createDecorator<any>('terminalService');
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


		const tagRegex = /<(?:tool_call|function_call|tool)>\s*([\s\S]*?)(?:\s*<\/(?:tool_call|function_call|tool)>|$)/gi;
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

		const funcRegex = /<(?:function|function_call|tool)(?:[=\s]+(?:name=)?["']?([a-zA-Z0-9_\-\.]+)["']?|\s+[^>]*?name=["']([a-zA-Z0-9_\-\.]+)["'])[^>]*>([\s\S]*?)(?:<\/(?:function|function_call|tool)>|$)/gi;
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
							const fileData = await fileService.readFile(uri);
							const rawText = fileData.value.toString();
							const defaultName = basename(uri).toLowerCase() === 'skill.md'
								? basename(dirname(uri))
								: (varAny.name || basename(uri).replace(/\.md$/, ''));
							const parsed = parseDynamicSkillMarkdown(rawText, defaultName);
							if (parsed.name && !resolvedSkills.has(parsed.name.toLowerCase())) {
								resolvedSkills.set(parsed.name.toLowerCase(), parsed);
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
							const fileData = await fileService.readFile(resolved.uri);
							const rawText = fileData.value.toString();
							const defaultName = basename(resolved.uri).toLowerCase() === 'skill.md'
								? basename(dirname(resolved.uri))
								: resolved.name;
							const parsed = parseDynamicSkillMarkdown(rawText, defaultName);
							if (parsed.name && !resolvedSkills.has(parsed.name.toLowerCase())) {
								resolvedSkills.set(parsed.name.toLowerCase(), parsed);
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
		if (!modelName || modelName === 'auto' || modelName.endsWith('/auto') || modelName.endsWith('/no-model-selected')) modelName = undefined;

		let chatEditingService: IChatEditingService | undefined;
		let fileService: IFileService | undefined;
		let customizationHarnessService: ICustomizationHarnessService | undefined;
		let todoListService: IChatTodoListService | undefined;
		let runStateService: IChatAgentRunStateService | undefined;
		let runState: IChatAgentRunState | undefined;
		let checkpointPersisted = false;
		let taskIsTracked = false;
		let activeTaskPrompt = '';
		let browserVerificationOnly = false;
		let consecutiveToolFailures = 0;
		let acceptedTaskCompletion = false;
		let proposedCompletionSummary: string | undefined;
		const successfulTaskActions = new Map<string, number>();
		const taskChangedFiles = new Set<string>();
		let taskConclusionEmitted = false;
		try {
			this.instantiationService.invokeFunction(accessor => {
				try { chatEditingService = accessor.get(IChatEditingService); } catch { }
				try { fileService = accessor.get(IFileService); } catch { }
				try { customizationHarnessService = accessor.get(ICustomizationHarnessService); } catch { }
				try { todoListService = accessor.get(IChatTodoListService); } catch { }
				try { runStateService = accessor.get(IChatAgentRunStateService); } catch { }
			});
		} catch { }

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
				if (verificationStatus === 'passed' && !failed) {
					addEvidence(`Verification command succeeded: ${command}`);
					verificationFailures = verificationFailures.filter(item => !item.startsWith(`Verification command: ${command} `));
					verificationPending = verificationPending.filter(item => !item.startsWith(`Verification command: ${command} `));
				} else if (verificationStatus === 'failed' || (verificationStatus === 'passed' && failed)) {
					verificationFailures = verificationFailures.filter(item => !item.startsWith(`Verification command: ${command} `));
					verificationPending = verificationPending.filter(item => !item.startsWith(`Verification command: ${command} `));
					verificationFailures.push(`Verification command: ${command} did not succeed.`);
				} else if (verificationStatus === 'inconclusive') {
					verificationPending = verificationPending.filter(item => !item.startsWith(`Verification command: ${command} `));
					verificationPending.push(`Verification command: ${command} has no confirmed completion status.`);
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
			} else if (browserAction && !failed && output.includes('### Active Browser Page Snapshot') && /✅/.test(output)) {
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
			if (!taskIsTracked || taskConclusionEmitted) {
				return;
			}
			taskConclusionEmitted = true;
			const status = runState?.status ?? 'blocked';
			const statusLabel = status === 'completed' && acceptedTaskCompletion
				? 'Complete'
				: token.isCancellationRequested || status === 'paused' || status === 'cancelled'
					? 'Paused'
					: 'Blocked';
			let todos = [] as ReturnType<IChatTodoListService['getTodos']>;
			try {
				todos = todoListService?.getTodos(request.sessionResource) ?? [];
			} catch {
				// A missing checklist must not suppress the final status report.
			}
			const completedTodos = todos.filter(todo => todo.status === 'completed').length;
			const pendingTodos = todos.filter(todo => todo.status !== 'completed');
			const allEvidence = runState?.verificationEvidence ?? [];
			const evidence = allEvidence.filter(item => item.workspaceRevision === runState?.workspaceRevision);
			const staleEvidence = allEvidence.filter(item => item.workspaceRevision !== runState?.workspaceRevision);
			const failures = runState?.verificationFailures ?? [];
			const pendingVerification = runState?.verificationPending ?? [];
			const lines = [
				'\n\n### Task summary',
				`**Status:** ${statusLabel}`,
			];
			if (status === 'completed' && acceptedTaskCompletion && proposedCompletionSummary?.trim()) {
				lines.push('', `**Work completed:** ${proposedCompletionSummary.trim().slice(0, 1800)}`);
			}
			lines.push('', status === 'completed' && acceptedTaskCompletion ? '**Recorded activity:**' : '**Work completed so far:**');
			if (successfulTaskActions.size > 0) {
				for (const [label, count] of successfulTaskActions) {
					lines.push(`- ${label}: ${count} successful action(s)`);
				}
			} else {
				lines.push('- No successful tool actions were recorded.');
			}
			if (taskChangedFiles.size > 0) {
				const fileList = [...taskChangedFiles];
				lines.push('', `**Changed files (${fileList.length}):** ${fileList.slice(0, 12).map(file => `\`${file}\``).join(', ')}${fileList.length > 12 ? `, and ${fileList.length - 12} more` : ''}`);
			}
			if (todos.length > 0) {
				lines.push('', `**Checklist:** ${completedTodos}/${todos.length} complete`);
			}
			if (evidence.length > 0) {
				lines.push('', '**Verification evidence:**');
				for (const item of evidence.slice(-6)) {
					lines.push(`- ${item.message.replace(/[\r\n\t]+/g, ' ').slice(0, 320)}`);
				}
			} else {
				lines.push('', '**Verification:** No verification evidence has been recorded.');
			}
			if (staleEvidence.length > 0) {
				lines.push('', `**Previous verification:** ${staleEvidence.length} item(s) are stale after a later workspace change and must be rerun.`);
			}
			if (failures.length > 0) {
				lines.push('', '**Verification issues:**');
				for (const item of failures.slice(0, 5)) {
					lines.push(`- ${item.replace(/[\r\n\t]+/g, ' ').slice(0, 320)}`);
				}
			}
			if (pendingVerification.length > 0) {
				lines.push('', '**Verification pending:**');
				for (const item of pendingVerification.slice(0, 5)) {
					lines.push(`- ${item.replace(/[\r\n\t]+/g, ' ').slice(0, 320)}`);
				}
			}
			if (status !== 'completed' || !acceptedTaskCompletion) {
				const blocker = runState?.lastError?.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
				lines.push('', `**Next step:** ${pendingTodos[0]?.title ?? runState?.nextStep ?? blocker ?? 'Resume from the checkpoint and verify the remaining items.'}`);
				if (blocker && blocker !== runState?.nextStep) {
					lines.push(`**Why work stopped:** ${blocker}`);
				}
			} else {
				lines.push('', '**Remaining work:** None; the agent completion checks passed.');
			}
			progress([{ kind: 'markdownContent', content: new MarkdownString(`${lines.join('\n')}\n\n`) }]);
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
			} catch {
				// Some non-UI or restored requests do not have a live session model.
			}

			const fullAccessRestrictedByPolicy = this.configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove).policyValue === false;
			return {
				permissionLevel: getDardcorEffectivePermissionLevel(selectedPermissionLevel, fullAccessRestrictedByPolicy) as ChatPermissionLevel | undefined,
				fullAccessRestricted: fullAccessRestrictedByPolicy && selectedPermissionLevel === ChatPermissionLevel.AutoApprove,
			};
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
						id: option.label,
						label: option.description ? `${option.label} - ${option.description}` : option.label,
						value: option.label,
					}))
					: [];
				const recommended = question?.options?.find((option: any) => option?.recommended)?.label;
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
				const review = new ChatPlanReviewData(args?.title || 'Implementation Plan', args?.content || '', actions, args?.canProvideFeedback !== false, undefined, toolCallId);
				progress([review as any]);
				try {
					const result = await raceCancellation(review.completion.p, token);
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
				const policyNote = permission.fullAccessRestricted ? 'Full access is restricted by organization policy.\n\n' : '';
				const result = await waitForQuestionAnswers(toolCallId, [{
					header: 'Terminal command approval',
					question: `${policyNote}Allow this exact command to run once?`,
					message: formatApprovalDetails(`${args?.explanation ? `${args.explanation}\n\n` : ''}${command}`),
					options: [{ label: 'Skip command', recommended: true }, { label: 'Allow once' }],
					allowFreeformInput: false,
					required: true,
				}], false);
				const answer = result.answers?.[`${toolCallId}:0`] as any;
				const selected = typeof answer === 'string' ? answer : answer?.selectedValue;
				const approved = selected === 'Allow once';
				if (approved) {
					approvedCommandKeys.add(commandApprovalKey(command, rootUri?.toString()));
				}
				return { output: result.error ?? JSON.stringify({ approved, command, scope: 'one-time exact command' }) };
			}

			const isCommandTool = ['run_command', 'run_in_terminal', 'bash', 'execute_command', 'cmd', 'sh', 'powershell', 'terminal', 'create_and_run_task', 'run_task', 'send_to_terminal', 'kill_terminal'].includes(toolName);
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
				const summary = isTerminalConfirmation
					? command.replace(/[\r\n\t]+/g, ' ').slice(0, 400)
					: summarizeDardcorToolAction(toolName, args);
				const result = await waitForQuestionAnswers(toolCallId, [{
					header: isTerminalConfirmation ? 'Terminal command approval' : 'Agent action approval',
					question: `${permission.fullAccessRestricted ? 'Full access is restricted by organization policy. ' : ''}${externalFileReadRequiresApproval ? 'This file is outside the workspace or could not be safely verified. Allow the agent to read it and include its contents in the model context once?' : `This ${isTerminalConfirmation ? 'terminal action' : 'agent action'} may change state or access an external resource. Allow this exact action once?`}`,
					message: formatApprovalDetails(summary),
					options: [{ label: isTerminalConfirmation ? 'Skip command' : 'Skip action', recommended: true }, { label: 'Allow once' }],
					allowFreeformInput: false,
					required: true,
				}], false);
				const answer = result.answers?.[`${toolCallId}:0`] as any;
				const selected = typeof answer === 'string' ? answer : answer?.selectedValue;
				if (result.error || selected !== 'Allow once') {
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
			let systemPrompt = buildDardcorSystemPrompt(snapshot);

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

			const messages: any[] = [
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
					for (const r of h.response as any[]) {
						if (!r) continue;
						if (typeof r === 'object') {
							if (r.content && typeof r.content === 'object' && typeof r.content.value === 'string') {
								respText += r.content.value;
							} else if (typeof r.content === 'string') {
								respText += r.content;
							} else if (r.kind === 'thinking' && typeof r.value === 'string') {
								if (!respText) respText += r.value;
							}
						}
					}
					respText = respText.replace(/\*\(No response content returned by model[^\)]*\)\*/g, '').trim();
					if (respText) {
						messages.push({ role: 'assistant', content: respText });
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
			const isContinuation = isDardcorContinuation(trimmedPrompt);
			const previousState = runStateService?.getState(request.sessionResource);
			const canResume = isContinuation && previousState && ['paused', 'blocked', 'planning', 'working', 'verifying'].includes(previousState.status);
			taskIsTracked = isContinuation ? !!canResume : isDardcorAutonomousTask(trimmedPrompt);
			activeTaskPrompt = canResume && previousState?.taskPrompt ? previousState.taskPrompt : trimmedPrompt;
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
				if (canResume && previousState) {
					runState = previousState;
					saveRunState({ status: 'working', stalledTurns: 0, lastError: undefined, taskPrompt: activeTaskPrompt, nextStep: previousState.nextStep || 'Review the checklist and continue from its first incomplete item.' });
					const pendingTodos = todoListService?.getTodos(request.sessionResource) ?? [];
					messages.push({
						role: 'system',
						content: `[Resumable Task Checkpoint]: Continue the saved task: ${activeTaskPrompt}. Prior status=${previousState.status}; completed agent turns=${previousState.turn}; current verification evidence=${previousState.verificationEvidence.filter(item => item.workspaceRevision === previousState.workspaceRevision).map(item => item.message).join(' | ') || 'none'}; stale historical evidence=${previousState.verificationEvidence.filter(item => item.workspaceRevision !== previousState.workspaceRevision).map(item => item.message).join(' | ') || 'none'}; workspace revision=${previousState.workspaceRevision}; unresolved verification failures=${previousState.verificationFailures.join(' | ') || 'none'}; browser actions=${previousState.browserActions}; last issue=${previousState.lastError || 'none'}; next step=${previousState.nextStep || 'review the checklist and continue from its first incomplete item'}. Current checklist: ${JSON.stringify(pendingTodos)}. Preserve completed work, update the checklist, and continue from the first unfinished item. If an operation was interrupted, inspect its actual terminal/browser/workspace result before retrying it.`
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
			} else {
				messages.push({ role: 'user', content: trimmedPrompt });
			}
			try {
				const modelsRes = await fetchRouter('/v1/models', { headers: { ...ROUTER_AUTH_HEADER, 'x-dardcor-router-connected-only': '1', 'x-drouter-connected-only': '1' } });
				if (modelsRes.ok) {
					const modelsData = await modelsRes.json() as any;
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
									modelName = raw;
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
								} else {
									modelName = modelsData.data[0].id;
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
					const capabilityResponse = await fetchRouter(`/v1/models/info?id=${encodeURIComponent(modelName)}`, {
						headers: ROUTER_AUTH_HEADER
					}, 1, 5000);
					if (capabilityResponse.ok) {
						routerModelCapabilities = normalizeDardcorRouterModelCapabilities(await capabilityResponse.json());
					}
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
				if (taskIsTracked) {
					progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: blocked** — ${runState?.lastError} ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; connect a model and send “continue”.\n\n`) }]);
				}
				return {};
			}

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

			while (true) {
				if (taskIsTracked) {
					const contextChars = JSON.stringify(messages).length;
					const guardReason = getDardcorRunGuardReason(contextChars);
					if (guardReason) {
						saveRunState({ status: 'paused', lastError: guardReason, nextStep: 'Resume this task after reviewing the saved checklist and first unfinished item.' });
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: paused** — ${guardReason} ${checkpointPersisted ? 'The checkpoint and next step are saved' : 'Checkpoint storage is unavailable'}; send “continue” to resume.\n\n`) }]);
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
				if (supportsNativeTools) {
					payload.tools = browserVerificationOnly
						? routerToolDefinitions.filter(tool => DARDCOR_BROWSER_VERIFICATION_TOOL_NAMES.has(tool.function.name))
						: routerToolDefinitions;
					payload.tool_choice = browserVerificationOnly ? 'required' : 'auto';
				}

				let streamedAssistantText = '';
				let streamedReasoningText = '';
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

					streamedAssistantText = '';
					streamedReasoningText = '';
					rawAssistantText = '';
					streamProtocolErrors = [];
					toolCallsMap.clear();
					sawStreamTerminal = false;

					let res: Response;
					try {
						res = await fetchRouter('/v1/chat/completions', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
							body: JSON.stringify(payload)
						}, 3, 60000);
					} catch (fetchErr: any) {
						lastStreamError = fetchErr;
						if (streamAttempt < MAX_STREAM_RETRIES && !token.isCancellationRequested) {
							const backoffMs = Math.min(1000 * Math.pow(2, streamAttempt - 1), 6000);
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(`\n\n> ⚠️ *Stream connection interrupted. Reconnecting to model... (Attempt ${streamAttempt}/${MAX_STREAM_RETRIES} in ${Math.round(backoffMs / 1000)}s)*\n\n`)
							}]);
							await new Promise(r => setTimeout(r, backoffMs));
							continue;
						} else {
							break;
						}
					}

					let responseErrorText: string | undefined;
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
									body: JSON.stringify(payload)
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
									body: JSON.stringify(payload)
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
						const isNonRetryable = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 404 ||
							/insufficient_credits|credits required|insufficient balance|payment required|unauthorized|pricingUrl/i.test(errorText);

						if (!isNonRetryable && streamAttempt < MAX_STREAM_RETRIES && (res.status === 429 || res.status >= 500) && !token.isCancellationRequested) {
							const backoffMs = Math.min(2000 * Math.pow(2, streamAttempt - 1), 8000);
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(`\n\n> ⚠️ *Model gateway returned HTTP ${res.status}. Retrying... (Attempt ${streamAttempt}/${MAX_STREAM_RETRIES} in ${Math.round(backoffMs / 1000)}s)*\n\n`)
							}]);
							await new Promise(r => setTimeout(r, backoffMs));
							continue;
						}
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString(formatDardcorRouterError(res.status, errorText, modelName))
						}]);
						if (taskIsTracked) {
							const reason = `Dardcor Router returned HTTP ${res.status} after retries: ${errorText.slice(0, 300)}`;
							const status = [400, 401, 402, 403, 404, 422].includes(res.status) ? 'blocked' : 'paused';
							saveRunState({ status, lastError: reason, nextStep: 'Resolve the Router/provider error, then resume from the saved checklist.' });
							progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: ${status}** — ${reason} ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; send “continue” after resolving the Router issue.\n\n`) }]);
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

					const thinkingParser = new DardcorThinkingStreamParser({
						onThinking: (chunk: string) => {
							streamedReasoningText += chunk;
							progress([{ kind: 'thinking', value: chunk }]);
						},
						onMarkdownContent: (chunk: string) => {
							streamedAssistantText += chunk;
							if (!taskIsTracked) {
								progress([{ kind: 'markdownContent', content: new MarkdownString(chunk) }]);
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
						try { reader.cancel(); } catch { }
					});

					const readWithTimeout = (r: typeof reader) => {
						return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
							const timer = setTimeout(() => {
								try { r.cancel(); } catch { }
								reject(new Error('Stream idle timeout'));
							}, 180000);
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
									if (tc.function?.name) existing.name += tc.function.name;
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
									content: new MarkdownString(`\n\n> ⚠️ *Stream connection interrupted. Reconnecting to model... (Attempt ${streamAttempt}/${MAX_STREAM_RETRIES} in ${Math.round(backoffMs / 1000)}s)*\n\n`)
								}]);
								await new Promise(r => setTimeout(r, backoffMs));
							}
						}
					} finally {
						cancelListener.dispose();
						try { reader.cancel(); } catch { }
					}
				}

				if (!streamSucceeded) {
					const reason = token.isCancellationRequested
						? 'The Router response was cancelled before a complete response arrived.'
						: `The Router response stream did not complete after ${MAX_STREAM_RETRIES} attempts${lastStreamError instanceof Error ? `: ${lastStreamError.message}` : '.'}`;
					if (taskIsTracked) {
						saveRunState({ status: 'paused', lastError: reason, nextStep: 'Resume from the saved checklist; the incomplete response and any partial tool calls were discarded.' });
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: paused** — ${reason} ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; send “continue” to retry safely.\n\n`) }]);
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
				const rawTextToolCalls = nativeToolCalls.length === 0 ? this._parseTextToolCalls(rawAssistantText || streamedAssistantText) : [];
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
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: blocked** — ${reason} ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; resume after the Router response format is fixed.\n\n`) }]);
					} else {
						progress([{ kind: 'markdownContent', content: new MarkdownString(`Router returned invalid streaming JSON frames and no action was executed: ${detail}`) }]);
					}
					break;
				}

				if (nativeToolCalls.length === 0 && textToolCalls.length === 0 && turn <= 12) {
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
							content: new MarkdownString(taskIsTracked
								? `> **Agent task: blocked** — Router connection failed before the project was completed. ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; verify Dardcor Router and send “continue” to resume.\n\n`
								: '*(Connection lost. Please verify your connection or try another model in [Dardcor Router](http://localhost:25128/).)*')
						}]);
					}
					return {};
				}

				if (!streamedAssistantText && streamedReasoningText.trim().length > 0 && nativeToolCalls.length === 0 && textToolCalls.length === 0) {
					if (emptyReasoningTurns < 1 && turn < 3 && !token.isCancellationRequested) {
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
						if (!taskIsTracked) {
							progress([{
								kind: 'markdownContent',
								content: new MarkdownString(cleanAnswer)
							}]);
						}
					}
				}

				if (!streamedAssistantText && !streamedReasoningText && nativeToolCalls.length === 0 && textToolCalls.length === 0) {
					if (consecutiveEmptyTurns < 2 && !token.isCancellationRequested) {
						consecutiveEmptyTurns++;
						if (supportsNativeTools) {
							supportsNativeTools = false;
							addDynamicFallbackTools();
						}
						messages.push({
							role: 'user',
							content: '[System Quality Guard]: No output was generated. Please answer the user prompt directly.'
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
							if (tc.name === 'task_completed') {
								acceptedTaskCompletion = true;
								completionArgs = parsedArgs;
								proposedCompletionSummary = typeof parsedArgs?.summary === 'string' ? parsedArgs.summary : undefined;
							}
							toolResult = await executeRouterToolThroughRuntime(tc.name, parsedArgs, tc.id) as typeof toolResult;
						}
						recordToolEvidence(tc.name, parsedArgs, toolResult.output, toolResult.externalEdit, toolResult.executionStatus);
						if (noteToolFailure(toolResult.output, toolResult.executionStatus)) {
							toolRunBlocked = true;
							saveRunState({ status: 'blocked', lastError: toolResult.output.slice(0, 500) });
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
							presentation: toolResult.externalEdit ? ToolInvocationPresentation.Hidden : undefined,
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
						const lastFailure = runState?.lastError?.replace(/[\r\n\t]+/g, ' ').slice(0, 320);
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: blocked** — three consecutive tool actions failed.${lastFailure ? ` Last error: ${lastFailure}.` : ''} The checkpoint and checklist are saved; send “continue” after correcting the cause.\n\n`) }]);
						break;
					}
					if (toolRunInterrupted) {
						saveRunState({ status: 'paused', lastError: 'Run cancelled while a tool action was in progress; inspect that action before retrying.' });
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: paused** — cancelled during a tool action. ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; inspect the action result before sending “continue”.\n\n`) }]);
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
								progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: blocked** — ${reason} ${checkpointPersisted ? 'Checkpoint, checklist and evidence are saved' : 'Checkpoint storage is unavailable'}; send “continue” after addressing this blocker.\n\n`) }]);
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
						}
						break;
					}

					continue;
				} else if (textToolCalls.length > 0) {
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
							if (tc.name === 'task_completed') {
								acceptedTaskCompletion = true;
								completionArgs = toolArgs;
								proposedCompletionSummary = typeof toolArgs?.summary === 'string' ? toolArgs.summary : undefined;
							}
							toolResult = await executeRouterToolThroughRuntime(tc.name, toolArgs, callId) as typeof toolResult;
						}
						recordToolEvidence(tc.name, toolArgs, toolResult.output, toolResult.externalEdit, toolResult.executionStatus);
						if (noteToolFailure(toolResult.output, toolResult.executionStatus)) {
							toolRunBlocked = true;
							saveRunState({ status: 'blocked', lastError: toolResult.output.slice(0, 500) });
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
							presentation: toolResult.externalEdit ? ToolInvocationPresentation.Hidden : undefined,
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
						const lastFailure = runState?.lastError?.replace(/[\r\n\t]+/g, ' ').slice(0, 320);
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: blocked** — three consecutive tool actions failed.${lastFailure ? ` Last error: ${lastFailure}.` : ''} The checkpoint and checklist are saved; send “continue” after correcting the cause.\n\n`) }]);
						break;
					}
					if (toolRunInterrupted) {
						saveRunState({ status: 'paused', lastError: 'Run cancelled while a tool action was in progress; inspect that action before retrying.' });
						progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: paused** — cancelled during a tool action. ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; inspect the action result before sending “continue”.\n\n`) }]);
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
								progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: blocked** — ${reason} ${checkpointPersisted ? 'Checkpoint, checklist and evidence are saved' : 'Checkpoint storage is unavailable'}; send “continue” after addressing this blocker.\n\n`) }]);
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
						}
						break;
					}

					continue;
				}

				if (taskIsTracked) {
					consecutiveTextTurns++;
					const textTurnLimit = browserVerificationOnly ? 2 : MAX_CONSECUTIVE_TEXT_TURNS;
					if (getDardcorPlainTextTurnDecision(taskIsTracked, consecutiveTextTurns, textTurnLimit) === 'continue' && !token.isCancellationRequested) {
						messages.push({ role: 'assistant', content: streamedAssistantText });
						const todoSnapshot = todoListService?.getTodos(request.sessionResource) ?? [];
						const currentRunState = runState;
						const currentVerificationEvidence = currentRunState
							? currentRunState.verificationEvidence.filter(item => item.workspaceRevision === currentRunState.workspaceRevision).map(item => item.message).join(' | ') || 'none'
							: 'none';
						messages.push({
							role: 'user',
							content: browserVerificationOnly
								? `[Runtime Browser Gate]: No browser tool call was produced. Use an enabled integrated Browser Editor tool now. Do not use terminal or HTTP as a substitute for live page evidence.`
								: `[Agent Workflow Guard]: The task is still ${currentRunState?.status ?? 'working'} and is not complete. Your last response had no valid action tool call, so it did not change the project or satisfy any checklist item. Checklist=${JSON.stringify(todoSnapshot)}. Current verification evidence=${currentVerificationEvidence}. Immediately call manage_todo_list if the checklist is missing, then take one concrete action with the available tools. Do not output a completion claim.`
						});
						continue;
					}
					const reason = token.isCancellationRequested
						? 'The user cancelled the run before all checklist items and verification were complete.'
						: `The model returned ${consecutiveTextTurns} consecutive responses without a valid action tool call.`;
					saveRunState({ status: token.isCancellationRequested ? 'paused' : 'blocked', lastError: reason });
					progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: ${token.isCancellationRequested ? 'paused' : 'blocked'}** — ${reason} ${checkpointPersisted ? 'The checkpoint is saved.' : 'Checkpoint storage is unavailable.'} Send “continue” to resume after resolving the issue.\n\n`) }]);
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
				saveRunState({ status: 'paused', lastError: reason, nextStep: runState.nextStep || 'Resume from the first incomplete checklist item.' });
				progress([{ kind: 'markdownContent', content: new MarkdownString(`\n\n> **Agent task: paused** — ${reason} ${checkpointPersisted ? 'The checkpoint is saved' : 'Checkpoint storage is unavailable'}; send “continue” to resume.\n\n`) }]);
			}

			return {};
		} catch (e: any) {
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
