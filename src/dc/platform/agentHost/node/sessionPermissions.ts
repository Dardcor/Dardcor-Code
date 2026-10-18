/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realpath as fsRealpath } from 'fs';
import { homedir } from 'os';
import { promisify } from 'util';
import { firstParallel } from '../../../base/common/async.js';
import { match as globMatch } from '../../../base/common/glob.js';
import { untildify } from '../../../base/common/labels.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import * as path from '../../../base/common/path.js';
import { isMacintosh, isWindows } from '../../../base/common/platform.js';
import { extUri, extUriBiasedIgnorePathCase, normalizePath } from '../../../base/common/resources.js';
import { isDefined } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ALWAYS_CHECKED_EDIT_PATTERNS, DEFAULT_EDIT_AUTO_APPROVE_PATTERNS } from '../../chat/common/chatSettings.js';
import { ILogService } from '../../log/common/log.js';
import { containsCmdDelayedExpansion } from '../../terminal/common/autoApprove/cmdDelayedExpansion.js';
import { AgentHostAutoApprovePolicyRestrictedConfigKey, AgentHostEditAutoApprovePatternsConfigKey, AgentHostGlobalAutoApproveEnabledConfigKey, AgentHostTerminalAutoApproveEnabledConfigKey, AgentHostTerminalAutoApproveRulesConfigKey, platformRootSchema, platformSessionSchema } from '../common/agentHostSchema.js';
import type { IAgentToolPendingConfirmationSignal } from '../common/agent.js';
import { ISessionDataService, isSessionAttachmentPath } from '../common/sessionDataService.js';
import { SessionConfigKey } from '../common/sessionConfigKeys.js';
import { ConfirmationOptionKind, type ConfirmationOption } from '../common/state/protocol/state.js';
import { ActionType, type IToolCallReadyAction } from '../common/state/sessionActions.js';
import {
	isAhpChatChannel,
	parseRequiredSessionUriFromChatUri,
	ResponsePartKind,
	ToolCallConfirmationReason,
	type URI as ProtocolURI,
} from '../common/state/sessionState.js';
import { getEffectiveWorkingDirectories, IAgentConfigurationService } from './agentConfigurationService.js';
import { AgentHostStateManager } from './agentHostStateManager.js';
import { CommandAutoApprover } from './commandAutoApprover.js';

export interface IToolApprovalEvent {
	readonly toolCallId: string;
	readonly session: URI;
	readonly permissionKind?: IAgentToolPendingConfirmationSignal['permissionKind'];
	readonly permissionPath?: string;
	readonly toolInput?: string;
	readonly requestSandboxBypass?: boolean;
	readonly shellLanguage?: IAgentToolPendingConfirmationSignal['shellLanguage'];
}

const ALLOW_SESSION_OPTION_ID = 'allow-session';
const ALLOW_ONCE_OPTION: ConfirmationOption = { id: 'allow-once', label: localize('sessionPermissions.allowOnce', "Allow Once"), kind: ConfirmationOptionKind.Approve };
const SKIP_OPTION: ConfirmationOption = { id: 'skip', label: localize('sessionPermissions.skip', "Skip"), kind: ConfirmationOptionKind.Deny, group: 2 };
const CONFIRMATION_OPTIONS: readonly ConfirmationOption[] = [
	{ id: ALLOW_SESSION_OPTION_ID, label: localize('sessionPermissions.allowSession', "Allow in this Session"), kind: ConfirmationOptionKind.Approve, group: 1 },
	ALLOW_ONCE_OPTION,
	SKIP_OPTION,
];
const MANAGED_CONFIRMATION_OPTIONS: readonly ConfirmationOption[] = [ALLOW_ONCE_OPTION, SKIP_OPTION];

const HOME_DIR = URI.file(homedir());

const PLATFORM_RESTRICTED_DIRS: readonly string[] = (
	isWindows
		? [process.env.APPDATA, process.env.LOCALAPPDATA]
		: isMacintosh
			? [homedir() + '/Library']
			: []
).filter(isDefined);

const realpath = promisify(fsRealpath);

function assertPathIsSafe(fsPath: string, _isWindows = isWindows): void {
	if (fsPath.includes('\0')) {
		throw new Error(`Path contains null bytes: ${fsPath}`);
	}

	if (!_isWindows) {
		return;
	}

	const colonIndex = fsPath.indexOf(':', 2);
	if (colonIndex !== -1) {
		throw new Error(`Path contains invalid characters (alternate data stream): ${fsPath}`);
	}

	const invalidChars = /[<>"|?*]/;
	const pathAfterDrive = fsPath.length > 2 ? fsPath.substring(2) : fsPath;
	if (invalidChars.test(pathAfterDrive)) {
		throw new Error(`Path contains invalid characters: ${fsPath}`);
	}

	if (fsPath.startsWith('\\\\.') || fsPath.startsWith('\\\\?')) {
		throw new Error(`Path is a reserved device path: ${fsPath}`);
	}

	const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

	const parts = fsPath.split('\\');
	for (const part of parts) {
		if (part.length === 0) {
			continue;
		}

		if (reserved.test(part)) {
			throw new Error(`Reserved device name in path: ${fsPath}`);
		}

		if (part.endsWith('.') || part.endsWith(' ')) {
			throw new Error(`Path contains invalid trailing characters: ${fsPath}`);
		}

		const tildeIndex = part.indexOf('~');
		if (tildeIndex !== -1) {
			const afterTilde = part.substring(tildeIndex + 1);
			if (afterTilde.length > 0 && /^\d/.test(afterTilde)) {
				throw new Error(`Path appears to use short filename format (8.3 names): ${fsPath}. Please use the full path.`);
			}
		}
	}
}

async function resolveRealPathForNonexistent(resource: URI, realpath: (fsPath: string) => Promise<string>): Promise<URI> {
	const fsPath = resource.fsPath;
	try {
		return URI.file(await realpath(fsPath));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw e;
		}
	}

	const tail: string[] = [path.basename(fsPath)];
	let current = path.dirname(fsPath);
	while (true) {
		const parent = path.dirname(current);
		if (parent === current) {
			return resource;
		}
		try {
			const resolved = await realpath(current);
			return URI.file(path.join(resolved, ...tail));
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code !== 'ENOENT' && code !== 'ENOTDIR') {
				throw e;
			}
		}
		tail.unshift(path.basename(current));
		current = parent;
	}
}

export class SessionPermissionManager extends Disposable {


	private readonly _commandAutoApprover: CommandAutoApprover;
	private readonly _realpath: (fsPath: string) => Promise<string>;

	constructor(
		private readonly _stateManager: AgentHostStateManager,
		options: { realpath?: (fsPath: string) => Promise<string> },
		@IAgentConfigurationService private readonly _configService: IAgentConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
	) {
		super();
		this._realpath = options?.realpath ?? realpath;
		this._commandAutoApprover = this._register(new CommandAutoApprover(this._logService));
	}

	initialize(): Promise<void> {
		return this._commandAutoApprover.initialize();
	}


	async getAutoApproval(e: IToolApprovalEvent, sessionKey: ProtocolURI): Promise<ToolCallConfirmationReason | undefined> {
		const workDirs = getEffectiveWorkingDirectories(this._stateManager, sessionKey);
		const workingDirectories = workDirs?.map(d => URI.parse(d));

		if (e.requestSandboxBypass) {
			return undefined;
		}

		if (this.isGlobalAutoApproveEnabled()) {
			return ToolCallConfirmationReason.Setting;
		}

		if (this.isSessionAutoApproveEnabled(sessionKey)) {
			return ToolCallConfirmationReason.Setting;
		}

		if (this._isToolAllowedByPermissions(sessionKey, e.toolCallId)) {
			return ToolCallConfirmationReason.Setting;
		}


		const surfaceScope = this._getSurfaceEditScope(sessionKey);
		if (surfaceScope) {
			if ((e.permissionKind === 'write' || e.permissionKind === 'read')
				&& e.permissionPath
				&& surfaceScope.target
				&& extUriBiasedIgnorePathCase.isEqual(URI.file(e.permissionPath), surfaceScope.target)
			) {
				this._logService.trace(`[SessionPermissionManager] Auto-approving in-scope surface ${e.permissionKind} of ${e.permissionPath}`);
				return ToolCallConfirmationReason.NotNeeded;
			}
			if (e.permissionKind === 'write' || e.permissionKind === 'shell') {
				this._logService.trace(`[SessionPermissionManager] Requiring confirmation for out-of-scope surface ${e.permissionKind}`);
				return undefined;
			}
		}

		if (e.permissionKind === 'read' && e.permissionPath) {
			const sessionUri = URI.parse(isAhpChatChannel(sessionKey) ? parseRequiredSessionUriFromChatUri(sessionKey) : sessionKey);
			if (isSessionAttachmentPath(this._sessionDataService, sessionUri, e.permissionPath)) {
				this._logService.trace(`[SessionPermissionManager] Auto-approving session attachment read of ${e.permissionPath}`);
				return ToolCallConfirmationReason.NotNeeded;
			}
			if (await this._isReadAutoApproved(URI.file(e.permissionPath), workingDirectories)) {
				this._logService.trace(`[SessionPermissionManager] Auto-approving read of ${e.permissionPath}`);
				return ToolCallConfirmationReason.NotNeeded;
			}
			return undefined;
		}

		if (e.permissionKind === 'write' && e.permissionPath) {
			if (await this._isEditAutoApproved(URI.file(e.permissionPath), workingDirectories)) {
				this._logService.trace(`[SessionPermissionManager] Auto-approving write to ${e.permissionPath}`);
				return ToolCallConfirmationReason.NotNeeded;
			}
			return undefined;
		}

		if (e.permissionKind === 'shell' && e.toolInput) {
			if (!e.shellLanguage) {
				this._logService.trace('[SessionPermissionManager] Shell language is missing, requiring confirmation');
				return undefined;
			}
			if (this._configService.getRootValue(platformRootSchema, AgentHostTerminalAutoApproveEnabledConfigKey) === false) {
				return undefined;
			}
			const result = this._commandAutoApprover.shouldAutoApprove(e.toolInput, {
				autoApproveRules: this._configService.getRootValue(platformRootSchema, AgentHostTerminalAutoApproveRulesConfigKey),
				isWriteDestApproved: dest => this._isShellWriteDestApproved(dest, workingDirectories),
				language: e.shellLanguage,
			});
			if (result === 'approved') {
				this._logService.trace('[SessionPermissionManager] Auto-approving shell command');
				return ToolCallConfirmationReason.NotNeeded;
			}
			if (result === 'denied') {
				this._logService.trace('[SessionPermissionManager] Shell command denied by rule');
			}
			return undefined;
		}

		return undefined;
	}

	private _getSurfaceEditScope(sessionKey: ProtocolURI): { readonly target: URI | undefined } | undefined {
		const session = isAhpChatChannel(sessionKey) ? parseRequiredSessionUriFromChatUri(sessionKey) : sessionKey;
		const surface = this._stateManager.getSessionSurfaceMeta(session);
		if (surface?.surface !== 'editorInline') {
			return undefined;
		}
		if (surface.targetUri === undefined) {
			return { target: undefined };
		}
		try {
			return { target: URI.parse(surface.targetUri) };
		} catch {
			this._logService.warn(`[SessionPermissionManager] Ignoring malformed inline chat target ${surface.targetUri}`);
			return { target: undefined };
		}
	}

	isForbiddenSnapshotWrite(e: IToolApprovalEvent, sessionKey: ProtocolURI): boolean {
		if (e.permissionKind !== 'write' || !e.permissionPath) {
			return false;
		}
		const sessionUri = URI.parse(isAhpChatChannel(sessionKey) ? parseRequiredSessionUriFromChatUri(sessionKey) : sessionKey);
		return isSessionAttachmentPath(this._sessionDataService, sessionUri, e.permissionPath);
	}

	isAutoApproveRuleResolvable(e: IToolApprovalEvent, sessionKey: ProtocolURI): boolean {
		if (e.permissionKind !== 'shell' || !e.toolInput || e.requestSandboxBypass || !e.shellLanguage) {
			return false;
		}
		if (this._configService.getRootValue(platformRootSchema, AgentHostTerminalAutoApproveEnabledConfigKey) === false) {
			return false;
		}
		const workDirs = getEffectiveWorkingDirectories(this._stateManager, sessionKey);
		const workingDirectories = workDirs?.map(d => URI.parse(d));
		return this._commandAutoApprover.evaluate(e.toolInput, {
			autoApproveRules: this._configService.getRootValue(platformRootSchema, AgentHostTerminalAutoApproveRulesConfigKey),
			isWriteDestApproved: dest => this._isShellWriteDestApproved(dest, workingDirectories),
			language: e.shellLanguage,
		}).autoApproveRuleResolvable;
	}





	isGlobalAutoApproveEnabled(): boolean {
		return this._configService.getRootValue(platformRootSchema, AgentHostGlobalAutoApproveEnabledConfigKey) === true;
	}

	getEffectiveApprovalLevel(sessionKey: ProtocolURI): string {
		if (this._configService.getRootValue(platformRootSchema, AgentHostAutoApprovePolicyRestrictedConfigKey) === true) {
			return 'default';
		}
		return this._configService.getEffectiveValue(sessionKey, platformSessionSchema, SessionConfigKey.AutoApprove) ?? 'default';
	}

	isSessionAutoApproveEnabled(sessionKey: ProtocolURI): boolean {
		return this.getEffectiveApprovalLevel(sessionKey) === 'autoApprove';
	}


	createToolReadyAction(e: IAgentToolPendingConfirmationSignal, _sessionKey: ProtocolURI, turnId: string): IToolCallReadyAction {
		const state = e.state;
		if (state.confirmationTitle) {
			return {
				type: ActionType.ChatToolCallReady,
				turnId,
				toolCallId: state.toolCallId,
				...(state.contributor ? { contributor: state.contributor } : {}),
				...(state.intention !== undefined ? { intention: state.intention } : {}),
				invocationMessage: state.invocationMessage,
				toolInput: state.toolInput,
				confirmationTitle: state.confirmationTitle,
				riskAssessment: state.riskAssessment,
				edits: state.edits,
				editable: state.editable,
				...(state._meta ? { _meta: state._meta } : {}),
				options: e.managedApprovalRequired
					? MANAGED_CONFIRMATION_OPTIONS.slice()
					: state.options
						? state.options.slice()
						: CONFIRMATION_OPTIONS.slice(),
			};
		}
		return {
			type: ActionType.ChatToolCallReady,
			turnId,
			toolCallId: state.toolCallId,
			...(state.contributor ? { contributor: state.contributor } : {}),
			...(state.intention !== undefined ? { intention: state.intention } : {}),
			invocationMessage: state.invocationMessage,
			toolInput: state.toolInput,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			...(state._meta ? { _meta: state._meta } : {}),
		};
	}


	handleToolCallConfirmed(chatChannel: ProtocolURI, toolCallId: string, selectedOptionId: string | undefined): void {
		if (!isAhpChatChannel(chatChannel)) {
			throw new Error(`Tool call confirmations must be handled on an AHP chat channel: ${chatChannel}`);
		}
		const sessionKey = parseRequiredSessionUriFromChatUri(chatChannel);
		if (selectedOptionId === ALLOW_SESSION_OPTION_ID) {
			const toolName = this._getToolNameForToolCall(chatChannel, toolCallId);
			if (toolName) {
				this._addToolToSessionPermissions(sessionKey, toolName);
			}
		}
	}


	private async _isReadAutoApproved(resource: URI, workingDirectories: readonly URI[] | undefined): Promise<boolean> {
		if (!workingDirectories || workingDirectories.length === 0) {
			return false;
		}
		const resourcesToCheck = this._resolveResourcesForApproval(resource);
		const match = await firstParallel(
			workingDirectories.map(directory => this._isReadContainedByRoot(resourcesToCheck, directory)),
			approved => approved,
		);
		return match === true;
	}

	private async _isReadContainedByRoot(resourcesToCheckPromise: Promise<readonly URI[] | undefined>, workingDirectory: URI): Promise<boolean> {
		const [resourcesToCheck, workingDirectories] = await Promise.all([resourcesToCheckPromise, this._resolveResourcesForApproval(workingDirectory)]);
		return resourcesToCheck !== undefined
			&& workingDirectories !== undefined
			&& resourcesToCheck.every(candidate => workingDirectories.some(directory => this._isResourceInDirectory(candidate, directory)));
	}

	private _isResourceInWorkingDirectory(resource: URI, workingDirectory: URI | undefined): boolean {
		return workingDirectory !== undefined && this._isResourceInDirectory(resource, workingDirectory);
	}

	private _isResourceInDirectory(resource: URI, directory: URI): boolean {
		return extUriBiasedIgnorePathCase.isEqualOrParent(normalizePath(resource), normalizePath(directory));
	}

	private _isShellWriteDestApproved(dest: string, workingDirectories: readonly URI[] | undefined): boolean {
		const resource = this._resolveShellRedirectResource(dest, workingDirectories?.[0]);
		if (!resource) {
			return false;
		}
		return (workingDirectories ?? []).some(workingDirectory => this._checkWriteResource(resource, workingDirectory));
	}

	private static readonly _dynamicRedirectDestRegex = /[$(){}`~%]/;

	private _resolveShellRedirectResource(dest: string, workingDirectory: URI | undefined): URI | undefined {
		const trimmed = untildify(dest.trim(), homedir());
		if (!trimmed) {
			return undefined;
		}
		if (SessionPermissionManager._dynamicRedirectDestRegex.test(trimmed) || containsCmdDelayedExpansion(trimmed)) {
			this._logService.trace(`[SessionPermissionManager] Redirect destination expands at runtime, requiring confirmation: ${dest}`);
			return undefined;
		}
		if (path.isAbsolute(trimmed)) {
			return URI.file(trimmed);
		}
		if (!workingDirectory) {
			return undefined;
		}
		return URI.file(path.resolve(workingDirectory.fsPath, trimmed));
	}

	private async _isEditAutoApproved(resource: URI, workingDirectories: readonly URI[] | undefined): Promise<boolean> {
		if (!workingDirectories || workingDirectories.length === 0) {
			return false;
		}
		const resourcesToCheck = await this._resolveResourcesForApproval(resource);
		if (resourcesToCheck === undefined) {
			return false;
		}
		return workingDirectories.some(workingDirectory => resourcesToCheck.every(candidate => this._checkWriteResource(candidate, workingDirectory)));
	}

	private async _resolveResourcesForApproval(resource: URI): Promise<URI[] | undefined> {
		const resourcesToCheck = [resource];
		if (resource.scheme !== Schemas.file) {
			return resourcesToCheck;
		}
		try {
			const resolved = await resolveRealPathForNonexistent(resource, this._realpath);
			if (!extUri.isEqual(resolved, resource)) {
				resourcesToCheck.push(resolved);
			}
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === 'EPERM' || code === 'EACCES') {
				return undefined;
			}
		}
		return resourcesToCheck;
	}

	private _checkWriteResource(resource: URI, workingDirectory: URI | undefined): boolean {
		try {
			assertPathIsSafe(resource.fsPath);
		} catch {
			return false;
		}
		if (!this._isResourceInWorkingDirectory(resource, workingDirectory)) {
			return false;
		}
		if (this._isPlatformRestrictedResource(resource, workingDirectory)) {
			return false;
		}
		return this._matchesEditAutoApprovePatterns(resource);
	}

	private _isPlatformRestrictedResource(resource: URI, workingDirectory: URI | undefined): boolean {
		const relativeToHome = extUriBiasedIgnorePathCase.relativePath(HOME_DIR, resource);
		const topLevelName = relativeToHome?.split('/')[0];
		if (extUriBiasedIgnorePathCase.isEqualOrParent(resource, HOME_DIR) && topLevelName?.startsWith('.')) {
			return true;
		}

		for (const restricted of PLATFORM_RESTRICTED_DIRS) {
			const parentURI = URI.file(restricted);
			if (extUriBiasedIgnorePathCase.isEqualOrParent(resource, parentURI)) {
				return !(workingDirectory && extUriBiasedIgnorePathCase.isEqualOrParent(workingDirectory, parentURI));
			}
		}
		return false;
	}

	private _matchesEditAutoApprovePatterns(resource: URI): boolean {
		let approved = true;
		const patterns = this._configService.getRootValue(platformRootSchema, AgentHostEditAutoApprovePatternsConfigKey) ?? DEFAULT_EDIT_AUTO_APPROVE_PATTERNS;
		const ignoreCase = extUriBiasedIgnorePathCase.ignorePathCasing(resource);
		for (const patternSet of [patterns, ALWAYS_CHECKED_EDIT_PATTERNS]) {
			for (const [pattern, configuredApproval] of Object.entries(patternSet)) {
				const isApproved = configuredApproval === true;
				if (isApproved !== approved && globMatch(pattern, resource.fsPath, { ignoreCase })) {
					approved = isApproved;
				}
			}
		}
		return approved;
	}

	private _isToolAllowedByPermissions(sessionKey: ProtocolURI, toolCallId: string): boolean {
		const toolName = this._getToolNameForToolCall(sessionKey, toolCallId);
		if (!toolName) {
			return false;
		}
		const permissions = this._configService.getEffectiveValue(sessionKey, platformSessionSchema, SessionConfigKey.Permissions);
		const allowed = permissions?.allow.includes(toolName) ?? false;
		if (allowed) {
			this._logService.trace(`[SessionPermissionManager] Auto-approving "${toolName}" via permissions`);
		}
		return allowed;
	}

	private _getToolNameForToolCall(sessionKey: ProtocolURI, toolCallId: string): string | undefined {
		const sessionState = this._stateManager.getSessionState(sessionKey);
		const parts = sessionState?.activeTurn?.responseParts;
		if (!parts) {
			return undefined;
		}
		for (const rp of parts) {
			if (rp.kind === ResponsePartKind.ToolCall && rp.toolCall.toolCallId === toolCallId) {
				return rp.toolCall.toolName;
			}
		}
		return undefined;
	}

	private _addToolToSessionPermissions(sessionKey: ProtocolURI, toolName: string): void {
		const permissions = this._configService.getEffectiveValue(sessionKey, platformSessionSchema, SessionConfigKey.Permissions)
			?? { allow: [], deny: [] };
		if (permissions.allow.includes(toolName)) {
			return;
		}
		this._configService.updateSessionConfig(sessionKey, {
			[SessionConfigKey.Permissions]: {
				allow: [...permissions.allow, toolName],
				deny: [...permissions.deny],
			},
		});
		this._logService.info(`[SessionPermissionManager] Added "${toolName}" to session permissions for ${sessionKey}`);
	}
}
