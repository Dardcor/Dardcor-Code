/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import assert from 'assert';
import { execSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'fs';
import { homedir, tmpdir, userInfo } from 'os';
import { fileURLToPath } from 'url';
import { timeout } from '../../../../../../base/common/async.js';
import { join } from '../../../../../../base/common/path.js';
import { removeAnsiEscapeCodes } from '../../../../../../base/common/strings.js';
import { URI } from '../../../../../../base/common/uri.js';
import {
	ResponsePartKind, ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind,
	ChatInputResponseKind, ToolResultContentType, ToolCallConfirmationReason, ToolCallCancellationReason, buildDefaultChatUri,
	getInlineToolInput, MessageKind, ROOT_STATE_URI, type MessageAttachment, type ChatInputAnswer, type ChatInputRequest, type RootState, type TerminalState,
	type ToolResultContent,
} from '../../../../common/state/sessionState.js';
import type { SubscribeResult } from '../../../../common/state/protocol/commands.js';
import { TerminalClaimKind } from '../../../../common/state/protocol/channels-terminal/state.js';
import {
	ActionType,
	type ChatInputRequestedAction, type ChatToolCallReadyAction,
	type ChatErrorAction, type ChatToolCallCompleteAction, type ChatToolCallStartAction,
} from '../../../../common/state/sessionActions.js';
import type { SessionMode } from '../../../../common/agentHostSchema.js';
import { AgentHostSessionResidencyLimitEnvVar } from '../../../../common/agentService.js';
import { CapiReplayMode, type ICapiReplayResponse } from './capiReplayProxy.js';
import {
	fetchSessionWithChat, getActionEnvelope, getAgentHostE2ETestTimeout, isActionNotification, IServerHandle, killServer, stopServer, TestProtocolClient,
} from '../../serverIntegrationTestHelpers.js';
import { defaultAgentHostTarget, type IAgentHostTarget } from './agentHostTarget.js';
import { createProviderSession, dispatchTurn, dispatchTurnWithAttachments } from '../../providerIntegrationTestHelpers.js';
import { AgentHostUpdateSnapshotsEnvVar, AhpSnapshotScenario, type IAhpSnapshotOptions } from './ahpSnapshot.js';
import { normalizeShellToolNameForCapture } from './shellToolNames.js';


const UPDATE_SNAPSHOTS = process.env[AgentHostUpdateSnapshotsEnvVar] === '1';
const RECORD = process.env['AGENT_HOST_REPLAY_RECORD'] === '1' || UPDATE_SNAPSHOTS;
const REPLAY_MODE: CapiReplayMode = RECORD ? 'record' : 'replay';

const MAX_MODEL_BACKED_TESTS_PER_SHARED_SERVER = 25;
const MAX_TESTS_PER_SHARED_SERVER = 40;
const TEMP_DIR_CLEANUP_TIMEOUT_MS = 30_000;
export const REPLAY_PLACEHOLDER_TOKEN = 'replay-no-token';
export type AgentHostE2EModelTraffic = 'recorded' | 'none';

function clearReadOnlyAttributes(dir: string): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const entryPath = join(dir, entry);
		try {
			const isDirectory = statSync(entryPath).isDirectory();
			chmodSync(entryPath, isDirectory ? 0o700 : 0o600);
			if (isDirectory) {
				clearReadOnlyAttributes(entryPath);
			}
		} catch {
		}
	}
}

export function initTestGitRepo(cwd: string): void {
	execSync('git init', { cwd });
	execSync('git config user.name "Agent Host Test"', { cwd });
	execSync('git config user.email "agent-host-test@example.com"', { cwd });
	execSync('git config gc.auto 0', { cwd });
}

export async function removeTempDirs(tempDirs: string[]): Promise<void> {
	const pendingDirs = tempDirs.splice(0);
	const errors = new Map<string, Error>();
	const deadline = Date.now() + TEMP_DIR_CLEANUP_TIMEOUT_MS;
	while (pendingDirs.length > 0) {
		for (let index = pendingDirs.length - 1; index >= 0; index--) {
			const dir = pendingDirs[index];
			try {
				rmSync(dir, { recursive: true, force: true });
				pendingDirs.splice(index, 1);
				errors.delete(dir);
			} catch (error) {
				errors.set(dir, error instanceof Error ? error : new Error(String(error)));
				clearReadOnlyAttributes(dir);
			}
		}
		if (pendingDirs.length === 0) {
			return;
		}
		if (Date.now() >= deadline) {
			throw new AggregateError(
				Array.from(errors.values()),
				`Failed to remove Agent Host E2E temporary directories: ${pendingDirs.join(', ')}`,
			);
		}
		await timeout(500);
	}
}

const CAPTURES_DIR = fileURLToPath(new URL('../../../../../../../../src/vs/platform/agentHost/test/node/e2e/captures/', import.meta.url));
const EMPTY_CAPTURE_PATH = join(CAPTURES_DIR, 'empty.yaml');

function fixturePathFor(provider: string, testTitle: string): string {
	const slug = testTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
	return join(CAPTURES_DIR, `${provider}-${slug}.yaml`);
}

const POSIX_COMMAND_EXCEPTIONS = new Set<string>([]);

const STALE_RECORDED_REQUEST_EXCEPTIONS = new Set<string>([
	'claude:side chat receives bounded source context without copied history',
]);

const RECOVERABLE_RECORDING_MODEL_RESPONSE: ICapiReplayResponse = {
	status: 400,
	headers: {
		'content-type': 'application/json',
	},
	body: '{"error":{"message":"Injected recoverable E2E failure.","type":"invalid_request_error","code":"invalid_request_error"}}',
};

const RECORDING_MODEL_RESPONSES = new Map<string, ICapiReplayResponse>([
	['copilotcli:resumes a failed turn in place', RECOVERABLE_RECORDING_MODEL_RESPONSE],
	['copilotcli:resumes the same turn after repeated failures', RECOVERABLE_RECORDING_MODEL_RESPONSE],
]);

function captureKey(provider: string, testTitle: string): string {
	return `${provider}:${testTitle}`;
}

export function capiReplayFor(provider: string, testTitle: string, modelTraffic: AgentHostE2EModelTraffic = 'recorded'): { fixturePath: string; real: true; mode: CapiReplayMode; allowPosixCommands: boolean; allowStaleRecordedRequest: boolean; recordingModelResponse?: ICapiReplayResponse } {
	const key = captureKey(provider, testTitle);
	const allowPosixCommands = POSIX_COMMAND_EXCEPTIONS.has(key);
	const allowStaleRecordedRequest = STALE_RECORDED_REQUEST_EXCEPTIONS.has(key);
	if (modelTraffic === 'none') {
		return { fixturePath: EMPTY_CAPTURE_PATH, real: true, mode: 'replay', allowPosixCommands, allowStaleRecordedRequest };
	}
	return { fixturePath: fixturePathFor(provider, testTitle), real: true, mode: REPLAY_MODE, allowPosixCommands, allowStaleRecordedRequest, recordingModelResponse: RECORDING_MODEL_RESPONSES.get(key) };
}



export function resolveGitHubToken(): string {
	if (!RECORD) {
		return REPLAY_PLACEHOLDER_TOKEN;
	}
	const envToken = process.env['GITHUB_TOKEN'];
	if (envToken) {
		return envToken;
	}
	try {
		return execSync('gh auth token', { encoding: 'utf-8' }).trim();
	} catch {
		throw new Error('No GITHUB_TOKEN set and `gh auth token` failed. Run `gh auth login` first.');
	}
}



export interface IAgentHostE2EProviderConfig {
	readonly suiteTitle: string;
	readonly provider: string;
	readonly modelProviders?: readonly string[];
	readonly scheme: string;
	readonly shellToolName: string;
	readonly fileOperationStrategy: 'fileTools' | 'shell';
	readonly subagentToolNames: readonly string[];
	readonly exitPlanModeToolName: string;
	readonly streamingFileCreateToolName?: string;
	readonly modelSwitchTarget?: string;
	readonly modelSwitchWireTarget?: string;
	readonly modelSwitchReturnTarget?: string;
	readonly modelSwitchWireReturnTarget?: string;
	readonly createSessionModelTarget?: string;
	readonly createSessionModelWireTarget?: string;
	readonly interactiveInputPrompt?: string;
	readonly cancelledInputPrompt?: string;
	readonly textInputPrompt?: string;
	readonly multiSelectInputPrompt?: string;
	readonly inputRequestMode?: SessionMode;
	readonly supportsWorkspacelessE2E?: boolean;
	readonly supportsRuntimeSlashCommandsE2E?: boolean;
	readonly supportsAttachmentsE2E?: boolean;
	readonly supportsTruncateE2E?: boolean;
	readonly supportsWorktreeIncludeFilesE2E?: boolean;
	readonly supportsPausedTurnCancellationE2E?: boolean;
	readonly supportsCustomizationDiscoveryE2E?: boolean;
	readonly supportsFixedInstructionDiscoveryE2E?: boolean;
	readonly supportsPluginCustomizationDiscoveryE2E?: boolean;
	readonly supportsWorkspaceAgentWatchE2E?: boolean;
	readonly enabled: boolean;
	readonly claudeSdkRoot?: string;
	readonly codexSdkRoot?: string;
	readonly supportsWorktreeIsolation: boolean;
	readonly supportsHostTerminalTool: boolean;
	readonly supportsSubagents: boolean;
	readonly supportsSideChats?: boolean;
	readonly supportsSideChatsE2E?: boolean;
	readonly shellToolReplayUnstableOnLinux?: boolean;
	readonly shellToolResultTextUnreliable?: boolean;
	readonly subagentReplayUnstableOnWindows?: boolean;
	readonly planModeStyle?: 'session-state' | 'input-request';
	readonly supportsMultipleChats: boolean;
	readonly supportsMultipleChatsE2E?: boolean;
	readonly supportsChatFork: boolean;
	readonly supportsChatForkE2E: boolean;

	readonly githubToken?: string;
}



export async function createRealSession(
	c: TestProtocolClient,
	config: IAgentHostE2EProviderConfig,
	clientId: string,
	trackingList: string[],
	workingDirectory: URI,
	beforeCreateSession?: () => Promise<void>,
): Promise<string> {
	const sessionUri = await createProviderSession(c, {
		provider: config.provider,
		scheme: config.scheme,
		githubToken: config.githubToken ?? resolveGitHubToken(),
	}, clientId, trackingList, workingDirectory, beforeCreateSession);
	c.setAhpSnapshotNormalization({
		workingDirectory: workingDirectory.fsPath,
		homeDirectory: homedir(),
		userName: userInfo().username,
	});
	c.clearAhpSnapshot();

	return sessionUri;
}

export async function runAhpSnapshotTest(
	c: TestProtocolClient,
	config: IAgentHostE2EProviderConfig,
	test: Mocha.Runnable,
	trackingList: string[],
	tempDirs: string[],
	options?: IAhpSnapshotOptions,
): Promise<void> {
	const scenario = AhpSnapshotScenario.load(test);
	const workingDirectory = mkdtempSync(join(tmpdir(), 'ahp-snapshot-'));
	tempDirs.push(workingDirectory);
	const sessionUri = await createRealSession(c, config, scenario.clientId, trackingList, URI.file(workingDirectory));
	await scenario.run(c, sessionUri, options);
}

export { dispatchTurn, dispatchTurnWithAttachments };



export function getAcceptedAnswers(request: ChatInputRequest): Record<string, ChatInputAnswer> | undefined {
	if (!request.questions?.length) {
		return undefined;
	}

	return Object.fromEntries(request.questions.map(question => {
		switch (question.kind) {
			case ChatInputQuestionKind.Text:
				return [question.id, {
					state: ChatInputAnswerState.Submitted,
					value: { kind: ChatInputAnswerValueKind.Text, value: question.defaultValue ?? 'interactive' },
				} satisfies ChatInputAnswer];
			case ChatInputQuestionKind.Number:
			case ChatInputQuestionKind.Integer:
				return [question.id, {
					state: ChatInputAnswerState.Submitted,
					value: { kind: ChatInputAnswerValueKind.Number, value: question.defaultValue ?? question.min ?? 1 },
				} satisfies ChatInputAnswer];
			case ChatInputQuestionKind.Boolean:
				return [question.id, {
					state: ChatInputAnswerState.Submitted,
					value: { kind: ChatInputAnswerValueKind.Boolean, value: question.defaultValue ?? true },
				} satisfies ChatInputAnswer];
			case ChatInputQuestionKind.SingleSelect: {
				const preferredOption = question.options.find(option => /exit_only/i.test(option.id))
					?? question.options.find(option => /interactive/i.test(option.id) || /interactive/i.test(option.label))
					?? question.options.find(option => option.recommended)
					?? question.options[0];
				return [question.id, {
					state: ChatInputAnswerState.Submitted,
					value: { kind: ChatInputAnswerValueKind.Selected, value: preferredOption.id },
				} satisfies ChatInputAnswer];
			}
			case ChatInputQuestionKind.MultiSelect: {
				const preferredOptions = question.options.filter(option => option.recommended);
				const selectedOptions = preferredOptions.length > 0 ? preferredOptions : question.options.slice(0, 1);
				return [question.id, {
					state: ChatInputAnswerState.Submitted,
					value: { kind: ChatInputAnswerValueKind.SelectedMany, value: selectedOptions.map(option => option.id) },
				} satisfies ChatInputAnswer];
			}
		}
	}));
}



export function getMarkdownResponseText(c: TestProtocolClient): string {
	const markdownPartIds = new Set<string>();
	const pieces: string[] = [];
	for (const notification of c.receivedNotifications(n =>
		isActionNotification(n, 'chat/responsePart') || isActionNotification(n, 'chat/delta')
	)) {
		const action = getActionEnvelope(notification).action;
		if (action.type === 'chat/responsePart' && action.part.kind === ResponsePartKind.Markdown) {
			markdownPartIds.add(action.part.id);
			pieces.push(action.part.content);
		} else if (action.type === 'chat/delta' && markdownPartIds.has(action.partId)) {
			pieces.push(action.content);
		}
	}
	return pieces.join('');
}

export interface IDrivenTurnResult {
	sawInputRequest: boolean;
	sawPendingConfirmation: boolean;
	responseText: string;
}

export async function driveTurnToCompletion(c: TestProtocolClient, session: string, turnId: string, text: string, clientSeq: number): Promise<IDrivenTurnResult> {
	return driveTurn(c, buildDefaultChatUri(session), turnId, clientSeq, () => dispatchTurn(c, session, turnId, text, clientSeq));
}

export async function driveChatTurnToCompletion(c: TestProtocolClient, chat: string, turnId: string, text: string, clientSeq: number): Promise<IDrivenTurnResult> {
	return driveTurn(c, chat, turnId, clientSeq, () => c.dispatch({
		channel: chat,
		clientSeq,
		action: {
			type: ActionType.ChatTurnStarted,
			turnId,
			startedAt: new Date().toISOString(),
			message: { text, origin: { kind: MessageKind.User } },
		},
	}));
}

export async function driveTurnWithAttachmentsToCompletion(c: TestProtocolClient, session: string, turnId: string, text: string, attachments: readonly MessageAttachment[], clientSeq: number): Promise<IDrivenTurnResult> {
	return driveTurn(c, buildDefaultChatUri(session), turnId, clientSeq, () => dispatchTurnWithAttachments(c, session, turnId, text, attachments, clientSeq));
}

export async function driveTurnWithModelToCompletion(c: TestProtocolClient, session: string, turnId: string, text: string, model: string, clientSeq: number): Promise<IDrivenTurnResult> {
	return driveTurn(c, buildDefaultChatUri(session), turnId, clientSeq, () => c.dispatch({
		channel: buildDefaultChatUri(session),
		clientSeq,
		action: {
			type: ActionType.ChatTurnStarted,
			turnId,
			startedAt: new Date().toISOString(),
			message: { text, origin: { kind: MessageKind.User }, model: { id: model } },
		},
	}));
}

export async function driveTurnWithCancelledInputToCompletion(c: TestProtocolClient, session: string, turnId: string, text: string, clientSeq: number): Promise<IDrivenTurnResult> {
	return driveTurn(c, buildDefaultChatUri(session), turnId, clientSeq, () => dispatchTurn(c, session, turnId, text, clientSeq), ChatInputResponseKind.Cancel);
}

export async function driveTurnWithAnswersToCompletion(c: TestProtocolClient, session: string, turnId: string, text: string, clientSeq: number, getAnswers: (request: ChatInputRequest) => Record<string, ChatInputAnswer>): Promise<IDrivenTurnResult> {
	return driveTurn(c, buildDefaultChatUri(session), turnId, clientSeq, () => dispatchTurn(c, session, turnId, text, clientSeq), ChatInputResponseKind.Accept, getAnswers);
}

async function driveTurn(c: TestProtocolClient, chat: string, turnId: string, clientSeq: number, dispatch: () => void, inputResponse = ChatInputResponseKind.Accept, answerProvider = getAcceptedAnswers): Promise<IDrivenTurnResult> {
	c.clearReceived();
	dispatch();

	const seenNotifications = new Set<object>();
	let nextClientSeq = clientSeq + 1;
	let sawInputRequest = false;
	let sawPendingConfirmation = false;

	while (true) {
		const notification = await c.waitForNotification(n => {
			if (seenNotifications.has(n as object)
				|| (!isActionNotification(n, 'chat/toolCallReady')
					&& !isActionNotification(n, 'chat/inputRequested')
					&& !isActionNotification(n, 'chat/turnComplete')
					&& !isActionNotification(n, 'chat/error'))) {
				return false;
			}
			if (getActionEnvelope(n).channel !== chat) {
				return false;
			}
			if (isActionNotification(n, 'chat/inputRequested')) {
				return true;
			}
			return (getActionEnvelope(n).action as { turnId: string }).turnId === turnId;
		}, 90_000);
		seenNotifications.add(notification as object);

		if (isActionNotification(notification, 'chat/error')) {
			const action = getActionEnvelope(notification).action as ChatErrorAction;
			throw new Error(`Session error while driving ${turnId}: ${action.part.error.errorType}: ${action.part.error.message}`);
		}

		if (isActionNotification(notification, 'chat/toolCallReady')) {
			const action = getActionEnvelope(notification).action as ChatToolCallReadyAction;
			if (!action.confirmed) {
				sawPendingConfirmation = true;
				c.dispatch({
					channel: chat,
					clientSeq: nextClientSeq++,
					action: {
						type: ActionType.ChatToolCallConfirmed,
						turnId,
						toolCallId: action.toolCallId,
						approved: true,
						confirmed: ToolCallConfirmationReason.UserAction,
					},
				});
			}
			continue;
		}

		if (isActionNotification(notification, 'chat/inputRequested')) {
			sawInputRequest = true;
			const action = getActionEnvelope(notification).action as ChatInputRequestedAction;
			c.dispatch({
				channel: chat,
				clientSeq: nextClientSeq++,
				action: {
					type: ActionType.ChatInputCompleted,
					requestId: action.request.id,
					response: inputResponse,
					answers: inputResponse === ChatInputResponseKind.Accept ? answerProvider(action.request) : undefined,
				},
			});
			continue;
		}


		const action = getActionEnvelope(notification).action as { turnId: string };
		assert.strictEqual(action.turnId, turnId);
		break;
	}

	return { sawInputRequest, sawPendingConfirmation, responseText: getMarkdownResponseText(c) };
}



export function terminalResourceFromContent(content: readonly ToolResultContent[]): string | undefined {
	const terminalContent = content.find(c => c.type === ToolResultContentType.Terminal);
	return terminalContent?.resource;
}

export function textFromContent(content: readonly ToolResultContent[]): string {
	return content
		.filter((c): c is Extract<ToolResultContent, { type: ToolResultContentType.Text }> => c.type === ToolResultContentType.Text)
		.map(c => c.text)
		.join('');
}

function toolResultText(content: readonly ToolResultContent[] | undefined): string {
	if (!content) {
		return '';
	}
	const terminalTexts: string[] = [];
	for (const part of content) {
		if (part.type !== ToolResultContentType.Terminal) {
			continue;
		}
		if (part.result?.preview) {
			terminalTexts.push(part.result.preview);
		}
	}
	return [textFromContent(content), ...terminalTexts].filter(text => text.length > 0).join('\n');
}

function normalizeToolResultText(value: string, workspace?: string): string {
	const withoutAnsi = removeAnsiEscapeCodes(value).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
	let normalizedWorkspace = withoutAnsi;
	if (workspace) {
		normalizedWorkspace = normalizedWorkspace
			.replaceAll(realpathSync(workspace), '${workdir}')
			.replaceAll(workspace, '${workdir}');
	}
	return normalizedWorkspace.replaceAll('\\', '/').trim();
}

export function assertToolCallCompleteText(
	client: TestProtocolClient,
	options: { readonly channel: string; readonly turnId: string; readonly toolNames: readonly string[]; readonly workspace?: string; readonly expected: readonly RegExp[]; readonly success?: boolean },
): void {
	const toolNames = new Set(options.toolNames.map(normalizeShellToolNameForCapture));
	const starts = client.receivedNotifications(n => isActionNotification(n, 'chat/toolCallStart'))
		.map(n => ({ envelope: getActionEnvelope(n), action: getActionEnvelope(n).action as ChatToolCallStartAction }))
		.filter(({ envelope, action }) => envelope.channel === options.channel && action.turnId === options.turnId && toolNames.has(normalizeShellToolNameForCapture(action.toolName)));
	const startedToolCallIds = new Set(starts.map(({ action }) => action.toolCallId));
	const completions = client.receivedNotifications(n => isActionNotification(n, 'chat/toolCallComplete'))
		.map(n => ({ envelope: getActionEnvelope(n), action: getActionEnvelope(n).action as ChatToolCallCompleteAction }))
		.filter(({ envelope, action }) => envelope.channel === options.channel && action.turnId === options.turnId && startedToolCallIds.has(action.toolCallId));
	const observed: { toolCallId: string; success: boolean; text: string }[] = [];
	let matchingCompletion: ChatToolCallCompleteAction | undefined;
	for (const { action } of completions) {
		if (options.success !== undefined && action.result.success !== options.success) {
			continue;
		}
		const text = normalizeToolResultText(toolResultText(action.result.content), options.workspace);
		observed.push({ toolCallId: action.toolCallId, success: action.result.success, text });
		if (options.expected.every(expected => expected.test(text))) {
			matchingCompletion = action;
			break;
		}
	}
	assert.ok(matchingCompletion, `expected ${options.turnId} to complete ${options.toolNames.join('/')} with result text matching ${options.expected.map(String).join(', ')}; observed ${observed.map(value => JSON.stringify(value)).join(', ')}`);
}

export function terminalText(state: TerminalState): string {
	return removeAnsiEscapeCodes(state.content.map(part => part.type === 'command' ? `${part.commandLine}\n${part.output}` : part.value).join(''));
}

export function findToolNameForCall(c: TestProtocolClient, toolCallId: string): string | undefined {
	return c.receivedNotifications(n => isActionNotification(n, 'chat/toolCallStart'))
		.map(n => getActionEnvelope(n).action as ChatToolCallStartAction)
		.find(a => a.toolCallId === toolCallId)?.toolName;
}

export interface IApprovalRule {
	readonly toolName: string;
	readonly matchInput?: (toolInput: string | undefined) => boolean;
	readonly inspect?: (info: { action: ChatToolCallReadyAction; errors: string[] }) => void;
}

export interface IBackgroundApprovalLoopOptions {
	readonly approvalSeqStart: number;
	readonly allow: readonly IApprovalRule[];
}

export interface IBackgroundApprovalLoop {
	readonly errors: readonly string[];
	readonly approvedToolNames: ReadonlySet<string>;
	readonly observedToolNames: ReadonlySet<string>;
	stop(): Promise<void>;
}

export function startBackgroundApprovalLoop(c: TestProtocolClient, options: IBackgroundApprovalLoopOptions): IBackgroundApprovalLoop {
	const errors: string[] = [];
	const approvedToolNames = new Set<string>();
	const observedToolNames = new Set<string>();
	const processedSeqs = new Set<number>();
	let active = true;
	let approvalSeq = options.approvalSeqStart;

	const loop = (async () => {
		while (active) {
			try {
				const ready = await c.waitForNotification(n => {
					if (!isActionNotification(n, 'chat/toolCallReady')) {
						return false;
					}
					return !processedSeqs.has(getActionEnvelope(n).serverSeq);
				}, 2_000);
				const envelope = getActionEnvelope(ready);
				processedSeqs.add(envelope.serverSeq);
				const action = envelope.action as ChatToolCallReadyAction;
				if (action.confirmed) {
					continue;
				}

				const toolName = findToolNameForCall(c, action.toolCallId);
				if (toolName) {
					observedToolNames.add(toolName);
				}
				const matchingRule = options.allow.find(rule =>
					rule.toolName === toolName
					&& (rule.matchInput?.(getInlineToolInput(action.toolInput)) ?? true));

				if (!matchingRule) {
					errors.push(`unexpected tool call: toolName=${toolName ?? '<unknown>'} input=${JSON.stringify(action.toolInput)}`);
					c.dispatch({
						channel: envelope.channel,
						clientSeq: ++approvalSeq,
						action: {
							type: ActionType.ChatToolCallConfirmed,
							turnId: action.turnId,
							toolCallId: action.toolCallId, approved: false,
							reason: ToolCallCancellationReason.Denied,
						},
					});
					continue;
				}

				matchingRule.inspect?.({ action, errors });
				approvedToolNames.add(matchingRule.toolName);

				c.dispatch({
					channel: envelope.channel,
					clientSeq: ++approvalSeq,
					action: {
						type: ActionType.ChatToolCallConfirmed,
						turnId: action.turnId,
						toolCallId: action.toolCallId, approved: true,
						confirmed: ToolCallConfirmationReason.UserAction,
					},
				});
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (!/timeout/i.test(msg)) {
					errors.push(`approval loop error: ${msg}`);
					active = false;
				}
			}
		}
	})();

	return {
		errors, approvedToolNames, observedToolNames,
		async stop(): Promise<void> {
			active = false;
			await loop;
		},
	};
}



export class AgentHostE2EServerLease {
	private _server: IServerHandle | undefined;
	private _client: TestProtocolClient | undefined;
	private readonly _shared: boolean;
	private _dataDir: string | undefined;
	private _modelBackedTestsOnCurrentServer = 0;
	private _testsOnCurrentServer = 0;
	private _cleanupClientSeq = 1_000_000;
	private _currentCapiReplay: ReturnType<typeof capiReplayFor> | undefined;
	private readonly _startOptions: { readonly claudeSdkRoot?: string; readonly codexSdkRoot?: string; readonly codexHomeDir: string; readonly homeDir: string; readonly userDataDir: string; readonly env: Readonly<Record<string, string>> };
	private readonly _target: IAgentHostTarget;

	constructor(
		private readonly _config: IAgentHostE2EProviderConfig,
		startOptions: { readonly claudeSdkRoot?: string; readonly codexSdkRoot?: string; readonly target?: IAgentHostTarget } = {},
	) {
		const dataDir = mkdtempSync(join(tmpdir(), 'vscode-agent-host-e2e-'));
		const codexHomeDir = join(dataDir, '.codex');
		mkdirSync(codexHomeDir);
		this._dataDir = dataDir;
		this._target = startOptions.target ?? defaultAgentHostTarget;
		this._startOptions = {
			claudeSdkRoot: startOptions.claudeSdkRoot,
			codexSdkRoot: startOptions.codexSdkRoot,
			codexHomeDir,
			homeDir: dataDir,
			userDataDir: join(dataDir, 'user-data'),
			env: { [AgentHostSessionResidencyLimitEnvVar]: '0' },
		};
		this._shared = !RECORD;
	}

	async acquire(testTitle: string, modelTraffic: AgentHostE2EModelTraffic = 'recorded'): Promise<{ server: IServerHandle; client: TestProtocolClient }> {
		const capiReplay = capiReplayFor(this._config.provider, testTitle, modelTraffic);
		this._currentCapiReplay = capiReplay;
		if (this._shared && this._server && (
			this._testsOnCurrentServer >= MAX_TESTS_PER_SHARED_SERVER
			|| this._modelBackedTestsOnCurrentServer >= MAX_MODEL_BACKED_TESTS_PER_SHARED_SERVER
		)) {
			await this._recycleSharedServer();
		}
		if (this._shared && this._server) {
			const proxy = this._server.capiReplay;
			if (!proxy) {
				throw new Error('[agent-host-e2e] shared replay server has no capiReplay proxy to reset');
			}
			proxy.resetForReplay(capiReplay.fixturePath, capiReplay.allowStaleRecordedRequest);
		} else {
			this._server = await this._target.launch({ ...this._startOptions, capiReplay, logLevel: this._isCopilotProvider ? 'trace' : undefined });
			this._modelBackedTestsOnCurrentServer = 0;
			this._testsOnCurrentServer = 0;
		}
		this._testsOnCurrentServer++;
		if (modelTraffic === 'recorded') {
			this._modelBackedTestsOnCurrentServer++;
		}
		this._client = new TestProtocolClient(
			this._server.port,
			() => this._server?.capiReplay?.takeReplayError(),
			workingDirectory => this._server?.capiReplay?.setWorkingDirectory(workingDirectory),
		);
		await this._client.connect();
		return { server: this._server, client: this._client };
	}

	async restart(): Promise<TestProtocolClient> {
		return this._restart(false);
	}

	async crashAndRestart(): Promise<TestProtocolClient> {
		return this._restart(true);
	}

	private async _restart(crash: boolean): Promise<TestProtocolClient> {
		const server = this._server;
		const proxy = server?.capiReplay;
		const capiReplay = this._currentCapiReplay;
		if (!server || !proxy || !capiReplay) {
			throw new Error('[agent-host-e2e] no replay-backed server to restart');
		}

		if (crash) {
			await killServer(server);
			this._client?.close();
		} else {
			this._client?.close();
			await stopServer(server);
		}
		this._client = undefined;
		this._server = undefined;

		try {
			this._server = await this._target.launch({
				...this._startOptions,
				capiReplay,
				existingCapiReplay: proxy,
				logLevel: this._isCopilotProvider ? 'trace' : undefined,
			});
		} catch (error) {
			await proxy.close();
			throw error;
		}

		const client = new TestProtocolClient(
			this._server.port,
			() => this._server?.capiReplay?.takeReplayError(),
			workingDirectory => this._server?.capiReplay?.setWorkingDirectory(workingDirectory),
		);
		await client.connect();
		this._client = client;
		return client;
	}

	setRecordingModelResponse(response: ICapiReplayResponse, path?: string): void {
		const proxy = this._server?.capiReplay;
		if (!proxy) {
			throw new Error('[agent-host-e2e] no replay-backed server');
		}
		proxy.setRecordingModelResponse(response, path);
	}

	async connectClient(): Promise<TestProtocolClient> {
		if (!this._server) {
			throw new Error('[agent-host-e2e] no server acquired yet');
		}
		const client = new TestProtocolClient(this._server.port);
		await client.connect();
		return client;
	}

	private async _recycleSharedServer(): Promise<void> {
		try {
			await this._server?.capiReplay?.close();
		} finally {
			await stopServer(this._server);
			this._server = undefined;
			this._modelBackedTestsOnCurrentServer = 0;
			this._testsOnCurrentServer = 0;
		}
	}

	get observedModelRequestBodies(): readonly string[] {
		return this._server?.capiReplay?.observedModelRequestBodies ?? [];
	}

	private get _isCopilotProvider(): boolean {
		return this._config.provider === 'copilotcli';
	}

	dumpRuntimeLogsOnFailure(label: string): void {
		if (!this._isCopilotProvider) {
			return;
		}
		try {
			const logsDir = join(this._startOptions.homeDir, '.copilot', 'logs');
			let entries: string[];
			try {
				entries = readdirSync(logsDir);
			} catch {
				process.stdout.write(`[agent-host-e2e] no Copilot runtime logs for failed test "${label}" (CLI never spawned; ${logsDir} absent)\n`);
				return;
			}
			const newest = entries
				.filter(name => /^process-.*\.log$/.test(name))
				.map(name => {
					const full = join(logsDir, name);
					try {
						return { full, mtimeMs: statSync(full).mtimeMs };
					} catch {
						return undefined;
					}
				})
				.filter((v): v is { full: string; mtimeMs: number } => v !== undefined)
				.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
			if (!newest) {
				process.stdout.write(`[agent-host-e2e] no Copilot runtime process-*.log for failed test "${label}" under ${logsDir}\n`);
				return;
			}
			const lines = readFileSync(newest.full, 'utf8').split(/\r?\n/);
			const tail = lines.slice(-200);
			process.stdout.write(`[agent-host-e2e] --- Copilot runtime log for failed test "${label}" (${newest.full}; last ${tail.length} of ${lines.length} lines) ---\n`);
			for (const ln of tail) {
				process.stdout.write(`[agent-host-e2e] # ${ln}\n`);
			}
			process.stdout.write('[agent-host-e2e] --- end Copilot runtime log ---\n');
		} catch {
		}
	}

	async release(createdSessions: string[], forceRestart = false): Promise<void> {
		const client = this._client;
		const cleanupErrors: Error[] = [];
		if (client) {
			const restoreTimeout = getAgentHostE2ETestTimeout(10_000, 30_000);
			const disposeTimeout = getAgentHostE2ETestTimeout(30_000, 90_000);
			for (const session of createdSessions) {
				try {
					const state = await fetchSessionWithChat(client, session, restoreTimeout);
					if (state.activeTurn) {
						const chat = buildDefaultChatUri(session);
						const turnId = state.activeTurn.id;
						client.dispatch({
							channel: chat,
							clientSeq: this._cleanupClientSeq++,
							action: { type: ActionType.ChatTurnCancelled, turnId, duration: 0 },
						});
						await client.waitForNotification(n =>
							isActionNotification(n, 'chat/turnCancelled')
							&& getActionEnvelope(n).channel === chat
							&& (getActionEnvelope(n).action as { turnId: string }).turnId === turnId,
							10_000,
						);
					}
					const root = await client.call<SubscribeResult>('subscribe', { channel: ROOT_STATE_URI }, restoreTimeout);
					const terminals = (root.snapshot!.state as RootState).terminals ?? [];
					for (const terminal of terminals) {
						if (terminal.claim.kind === TerminalClaimKind.Session && terminal.claim.session === session) {
							await client.call('disposeTerminal', { channel: terminal.resource }, disposeTimeout);
						}
					}
					await client.call('disposeSession', { channel: session }, disposeTimeout);
				} catch (error) {
					cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
				}
			}
			client.close();
		}
		createdSessions.length = 0;
		this._client = undefined;

		const mustRestart = forceRestart || cleanupErrors.length > 0;
		if (this._shared && !mustRestart) {
			try {
				this._server?.capiReplay?.assertNoReplayMismatches();
			} catch (error) {
				cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
				try {
					await this._server?.capiReplay?.close();
				} catch (stopError) {
					cleanupErrors.push(stopError instanceof Error ? stopError : new Error(String(stopError)));
				}
				try {
					await stopServer(this._server);
				} catch (stopError) {
					cleanupErrors.push(stopError instanceof Error ? stopError : new Error(String(stopError)));
				}
				this._server = undefined;
				this._modelBackedTestsOnCurrentServer = 0;
				this._testsOnCurrentServer = 0;
			}
		} else {
			try {
				if (forceRestart) {
					await this._server?.capiReplay?.close();
				} else {
					await this._server?.capiReplay?.stop();
				}
			} catch (error) {
				cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
			} finally {
				try {
					await stopServer(this._server);
				} catch (error) {
					cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
				}
				this._server = undefined;
				this._modelBackedTestsOnCurrentServer = 0;
				this._testsOnCurrentServer = 0;
			}
		}
		if (cleanupErrors.length > 0) {
			if (forceRestart) {
				process.stdout.write(`[agent-host-e2e] cleanup reported ${cleanupErrors.length} secondary error(s) after the test failed:\n`);
				for (const error of cleanupErrors) {
					process.stdout.write(`[agent-host-e2e] # ${error.message}\n`);
				}
				return;
			}
			throw new AggregateError(cleanupErrors, `Failed to release Agent Host E2E test resources: ${cleanupErrors.map(error => error.message).join('; ')}`);
		}
	}

	async dispose(): Promise<void> {
		const dataDir = this._dataDir;
		this._dataDir = undefined;
		try {
			if (this._server) {
				try {
					await this._server.capiReplay?.close();
				} finally {
					await stopServer(this._server);
					this._server = undefined;
				}
			}
		} finally {
			if (dataDir) {
				await removeTempDirs([dataDir]);
			}
		}
	}
}



