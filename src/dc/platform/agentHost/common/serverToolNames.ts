/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum SessionServerToolName {
	ListSessions = 'list_sessions',
	GetCurrentSession = 'get_current_session',
	SetWorkspace = 'set_workspace',
	CreateSession = 'create_session',
	CreateChat = 'create_chat',
	RenameChat = 'rename_chat',
	SendMessage = 'send_message',
	GetSessionContext = 'get_session_context',
	DeleteSession = 'delete_session',
}

export const enum ArtifactServerToolName {
	AddArtifactOrReference = 'add_artifact_or_reference',
	RemoveArtifactOrReference = 'remove_artifact_or_reference',
	ListArtifactsAndReferences = 'list_artifacts_and_references',
}

export const LEGACY_ARTIFACT_SERVER_TOOL_NAMES: ReadonlyMap<string, string> = new Map([
	['add_artifact', ArtifactServerToolName.AddArtifactOrReference as string],
	['remove_artifact', ArtifactServerToolName.RemoveArtifactOrReference as string],
	['list_artifacts', ArtifactServerToolName.ListArtifactsAndReferences as string],
]);
