/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { ErrorInfo, URI } from '../common/state.js';
import type { ToolDefinition, SessionActiveClient, SessionInputRequest, Customization, CustomizationEnablement, McpServerState } from './state.js';
import type { Changeset } from '../channels-changeset/state.js';
import type { ChatSummary } from '../channels-chat/state.js';


export interface SessionReadyAction {
	type: ActionType.SessionReady;
}

export interface SessionCreationFailedAction {
	type: ActionType.SessionCreationFailed;
	error: ErrorInfo;
}

export interface SessionChatAddedAction {
	type: ActionType.SessionChatAdded;
	summary: ChatSummary;
}

export interface SessionChatRemovedAction {
	type: ActionType.SessionChatRemoved;
	chat: URI;
}

export interface SessionChatUpdatedAction {
	type: ActionType.SessionChatUpdated;
	chat: URI;
	changes: Partial<ChatSummary>;
}

export interface SessionDefaultChatChangedAction {
	type: ActionType.SessionDefaultChatChanged;
	defaultChat?: URI;
}

export interface SessionTitleChangedAction {
	type: ActionType.SessionTitleChanged;
	title: string;
}

export interface SessionIsReadChangedAction {
	type: ActionType.SessionIsReadChanged;
	isRead: boolean;
}

export interface SessionIsArchivedChangedAction {
	type: ActionType.SessionIsArchivedChanged;
	isArchived: boolean;
}

export interface SessionActivityChangedAction {
	type: ActionType.SessionActivityChanged;
	activity: string | undefined;
}

export interface SessionChangesetsChangedAction {
	type: ActionType.SessionChangesetsChanged;
	changesets: Changeset[] | undefined;
}

export interface SessionServerToolsChangedAction {
	type: ActionType.SessionServerToolsChanged;
	tools: ToolDefinition[];
}

export interface SessionActiveClientSetAction {
	type: ActionType.SessionActiveClientSet;
	activeClient: SessionActiveClient;
}

export interface SessionActiveClientRemovedAction {
	type: ActionType.SessionActiveClientRemoved;
	clientId: string;
}


export interface SessionWorkingDirectorySetAction {
	type: ActionType.SessionWorkingDirectorySet;
	directory: URI;
}

export interface SessionWorkingDirectoryRemovedAction {
	type: ActionType.SessionWorkingDirectoryRemoved;
	directory: URI;
}

export interface SessionWorkingDirectoryReplacedAction {
	type: ActionType.SessionWorkingDirectoryReplaced;
	directory: URI;
	replacement: URI;
}


export interface SessionInputNeededSetAction {
	type: ActionType.SessionInputNeededSet;
	request: SessionInputRequest;
}

export interface SessionInputNeededRemovedAction {
	type: ActionType.SessionInputNeededRemoved;
	id: string;
}


export interface SessionCustomizationsChangedAction {
	type: ActionType.SessionCustomizationsChanged;
	customizations: Customization[];
}

export interface SessionCustomizationToggledAction {
	type: ActionType.SessionCustomizationToggled;
	id: string;
	enablement: CustomizationEnablement[];
}

export interface SessionCustomizationUpdatedAction {
	type: ActionType.SessionCustomizationUpdated;
	customization: Customization;
}

export interface SessionCustomizationRemovedAction {
	type: ActionType.SessionCustomizationRemoved;
	id: string;
}

export interface SessionMcpServerStateChangedAction {
	type: ActionType.SessionMcpServerStateChanged;
	id: string;
	state: McpServerState;
	channel?: URI;
}

export interface SessionMcpServerStartRequestedAction {
	type: ActionType.SessionMcpServerStartRequested;
	id: string;
}

export interface SessionMcpServerStopRequestedAction {
	type: ActionType.SessionMcpServerStopRequested;
	id: string;
}


export interface SessionConfigChangedAction {
	type: ActionType.SessionConfigChanged;
	config: Record<string, unknown>;
	replace?: boolean;
}

export interface SessionMetaChangedAction {
	type: ActionType.SessionMetaChanged;
	_meta: Record<string, unknown> | undefined;
}
