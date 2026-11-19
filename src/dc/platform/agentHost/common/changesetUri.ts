/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { readAgentMergeSessionState } from './agentMerge.js';
import { isAgentMergeMessage } from './meta/agentMergeMessageMeta.js';
import { AgentSystemNotificationKind, readAgentSystemNotificationMeta } from './meta/agentSystemNotificationMeta.js';
import { MessageKind, readSessionGitState, readSessionWorkspaceless, ResponsePartKind, SessionLifecycle, type Changeset, type ISessionGitState, type ISessionWithDefaultChat, type URI } from './state/sessionState.js';


const BRANCH_CHANGESET_ID = 'branch';

const UNCOMMITTED_CHANGESET_ID = 'uncommitted';

const SESSION_CHANGESET_ID = 'session';

export const AGENT_MERGE_CHANGESET_ID = 'agent-merge';

const TURN_CHANGESET_PREFIX = 'turn/';

const TURN_TEMPLATE_VARIABLE = '{turnId}';

const COMPARE_CHANGESET_PREFIX = 'compare/';

const COMPARE_ORIGINAL_TEMPLATE_VARIABLE = '{originalTurnId}';

const COMPARE_MODIFIED_TEMPLATE_VARIABLE = '{modifiedTurnId}';

export const branchChangesetLabel = (): string => localize('branchChangeset.label', "Branch Changes");

export const sessionChangesetLabel = (): string => localize('sessionChangeset.label', "Session Changes");

export const sessionChangesetDescription = (): string => localize('sessionChangeset.description', "Show all changes made in this session");

export const uncommittedChangesetLabel = (): string => localize('uncommittedChangeset.label', "Uncommitted Changes");

export const uncommittedChangesetDescription = (): string => localize('uncommittedChangeset.description', "Show uncommitted changes in this session");

export const thisTurnChangesetLabel = (): string => localize('thisTurnChangeset.label', "This Turn");

export const thisTurnChangesetDescription = (): string => localize('thisTurnChangeset.description', "Show changes made in this turn");

export const compareTurnsChangesetLabel = (): string => localize('compareTurnsChangeset.label', "Compare Turns");

export const compareTurnsChangesetDescription = (): string => localize('compareTurnsChangeset.description', "Show changes made between different turns");

const agentMergeChangesetLabel = (): string => localize('agentMergeChangeset.label', "Agent Merge Changes");

const agentMergeChangesetDescription = (): string => localize('agentMergeChangeset.description', "Show changes made by Agent Merge since the last user message");

export function formatBranchChangesetDescription(gitState: ISessionGitState): string | undefined {
	const { baseBranchName, branchName, upstreamBranchName } = gitState;

	if (baseBranchName && branchName) {
		return `${branchName} → ${baseBranchName}`;
	}

	if (upstreamBranchName && branchName) {
		return `${branchName} → ${upstreamBranchName}`;
	}

	return branchName;
}

const CHANGESET_PATH_SEGMENT = '/changeset/';

export const enum ChangesetKind {
	Branch = 'branch',
	Uncommitted = 'uncommitted',
	Session = 'session',
	Turn = 'turn',
	Compare = 'compare-turns',
	Unknown = 'unknown',
}

export type DefaultChangesetKind = ChangesetKind.Branch | ChangesetKind.Uncommitted | ChangesetKind.Session;

export function selectDefaultChangeset<T extends Pick<Changeset, 'changeKind'>>(
	changesets: readonly T[] | undefined,
	defaultKind: DefaultChangesetKind = ChangesetKind.Branch,
): T | undefined {
	return changesets?.find(changeset => changeset.changeKind === defaultKind) ?? changesets?.[0];
}

const URI_SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/;

export function resolveChangesetUriTemplate(sessionUri: URI, uriTemplate: string): string {
	if (URI_SCHEME_PREFIX.test(uriTemplate)) {
		return uriTemplate;
	}
	return `${sessionUri.replace(/\/+$/, '')}/${uriTemplate.replace(/^\/+/, '')}`;
}

export function buildBranchChangesetUri(sessionUri: URI): URI {
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${BRANCH_CHANGESET_ID}`;
}

export function buildSessionChangesetUri(sessionUri: URI): URI {
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${SESSION_CHANGESET_ID}`;
}

export function buildUncommittedChangesetUri(sessionUri: URI): URI {
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${UNCOMMITTED_CHANGESET_ID}`;
}

export function buildTurnChangesetUriTemplate(sessionUri: URI): URI {
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${TURN_CHANGESET_PREFIX}${TURN_TEMPLATE_VARIABLE}`;
}

export function buildTurnChangesetUri(sessionUri: URI, turnId: string): URI {
	if (!turnId || turnId.includes('/')) {
		throw new Error(`buildTurnChangesetUri: turnId must be non-empty and not contain '/' (got ${JSON.stringify(turnId)})`);
	}
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${TURN_CHANGESET_PREFIX}${turnId}`;
}

export function buildCompareTurnsChangesetUriTemplate(sessionUri: URI): URI {
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${COMPARE_CHANGESET_PREFIX}${COMPARE_ORIGINAL_TEMPLATE_VARIABLE}/${COMPARE_MODIFIED_TEMPLATE_VARIABLE}`;
}

export function buildCompareTurnsChangesetUri(sessionUri: URI, originalTurnId: string, modifiedTurnId: string): URI {
	if (!originalTurnId || originalTurnId.includes('/')) {
		throw new Error(`buildCompareTurnsChangesetUri: originalTurnId must be non-empty and not contain '/' (got ${JSON.stringify(originalTurnId)})`);
	}
	if (!modifiedTurnId || modifiedTurnId.includes('/')) {
		throw new Error(`buildCompareTurnsChangesetUri: modifiedTurnId must be non-empty and not contain '/' (got ${JSON.stringify(modifiedTurnId)})`);
	}
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${COMPARE_CHANGESET_PREFIX}${originalTurnId}/${modifiedTurnId}`;
}

export function buildChangesetUri(sessionUri: URI, changesetId: string): URI {
	if (!changesetId) {
		throw new Error('buildChangesetUri: changesetId must be non-empty');
	}
	if (changesetId.includes('/')) {
		throw new Error(`buildChangesetUri: changesetId must not contain '/' (got ${JSON.stringify(changesetId)})`);
	}
	return `${sessionUri}${CHANGESET_PATH_SEGMENT}${changesetId}`;
}

export function parseChangesetUri(uri: URI): { sessionUri: URI; changesetId: string; kind: ChangesetKind; turnId?: string; originalTurnId?: string; modifiedTurnId?: string } | undefined {
	const idx = uri.lastIndexOf(CHANGESET_PATH_SEGMENT);
	if (idx < 0) {
		return undefined;
	}
	const changesetId = uri.slice(idx + CHANGESET_PATH_SEGMENT.length);
	if (!changesetId) {
		return undefined;
	}
	const sessionUri = uri.slice(0, idx);
	if (changesetId === BRANCH_CHANGESET_ID) {
		return { sessionUri, changesetId, kind: ChangesetKind.Branch };
	}
	if (changesetId === UNCOMMITTED_CHANGESET_ID) {
		return { sessionUri, changesetId, kind: ChangesetKind.Uncommitted };
	}
	if (changesetId === SESSION_CHANGESET_ID) {
		return { sessionUri, changesetId, kind: ChangesetKind.Session };
	}
	if (changesetId.startsWith(TURN_CHANGESET_PREFIX)) {
		const turnId = changesetId.slice(TURN_CHANGESET_PREFIX.length);
		if (!turnId || turnId.includes('/') || turnId === TURN_TEMPLATE_VARIABLE) {
			return undefined;
		}
		return { sessionUri, changesetId, kind: ChangesetKind.Turn, turnId };
	}
	if (changesetId.startsWith(COMPARE_CHANGESET_PREFIX)) {
		const tail = changesetId.slice(COMPARE_CHANGESET_PREFIX.length);
		const parts = tail.split('/');
		if (parts.length !== 2) {
			return undefined;
		}
		const [originalTurnId, modifiedTurnId] = parts;
		if (!originalTurnId || !modifiedTurnId
			|| originalTurnId === COMPARE_ORIGINAL_TEMPLATE_VARIABLE
			|| modifiedTurnId === COMPARE_MODIFIED_TEMPLATE_VARIABLE) {
			return undefined;
		}
		return { sessionUri, changesetId, kind: ChangesetKind.Compare, originalTurnId, modifiedTurnId };
	}
	if (changesetId.includes('/')) {
		return undefined;
	}
	return { sessionUri, changesetId, kind: ChangesetKind.Unknown };
}

export function isChangesetUri(uri: URI): boolean {
	return parseChangesetUri(uri) !== undefined;
}

export function isSessionChangesetUri(uri: URI): boolean {
	return parseChangesetUri(uri)?.kind === ChangesetKind.Session;
}

export function isUncommittedChangesetUri(uri: URI): boolean {
	return parseChangesetUri(uri)?.kind === ChangesetKind.Uncommitted;
}

export function parseTurnChangesetUri(uri: URI): { sessionUri: URI; turnId: string } | undefined {
	const parsed = parseChangesetUri(uri);
	if (parsed?.kind !== ChangesetKind.Turn || parsed.turnId === undefined) {
		return undefined;
	}
	return { sessionUri: parsed.sessionUri, turnId: parsed.turnId };
}

export function parseCompareTurnsChangesetUri(uri: URI): { sessionUri: URI; originalTurnId: string; modifiedTurnId: string } | undefined {
	const parsed = parseChangesetUri(uri);
	if (parsed?.kind !== ChangesetKind.Compare || parsed.originalTurnId === undefined || parsed.modifiedTurnId === undefined) {
		return undefined;
	}
	return { sessionUri: parsed.sessionUri, originalTurnId: parsed.originalTurnId, modifiedTurnId: parsed.modifiedTurnId };
}

export function buildDefaultChangesetCatalog(sessionUri: URI, state?: ISessionWithDefaultChat): Changeset[] {
	if (!state || state.lifecycle === SessionLifecycle.Failed) {
		return [];
	}

	if (state.lifecycle === SessionLifecycle.Creating) {
		if (readSessionWorkspaceless(state._meta)) {
			return [];
		}

		return [{
			label: uncommittedChangesetLabel(),
			description: uncommittedChangesetDescription(),
			uriTemplate: buildUncommittedChangesetUri(sessionUri),
			changeKind: ChangesetKind.Uncommitted
		}];
	}

	const gitState = readSessionGitState(state._meta);
	const agentMergeChangeset = shouldAdvertiseAgentMergeChangeset(state)
		? [{
			label: agentMergeChangesetLabel(),
			description: agentMergeChangesetDescription(),
			uriTemplate: buildCompareTurnsChangesetUriTemplate(sessionUri),
			changeKind: AGENT_MERGE_CHANGESET_ID,
		}] satisfies Changeset[]
		: [];

	if (!gitState) {
		return [{
			label: sessionChangesetLabel(),
			description: sessionChangesetDescription(),
			uriTemplate: buildSessionChangesetUri(sessionUri),
			changeKind: ChangesetKind.Session
		},
		{
			label: thisTurnChangesetLabel(),
			description: thisTurnChangesetDescription(),
			uriTemplate: buildTurnChangesetUriTemplate(sessionUri),
			changeKind: ChangesetKind.Turn
		},
		...agentMergeChangeset] satisfies Changeset[];
	}

	return [
		{
			label: branchChangesetLabel(),
			description: gitState
				? formatBranchChangesetDescription(gitState)
				: undefined,
			uriTemplate: buildBranchChangesetUri(sessionUri),
			changeKind: ChangesetKind.Branch,
			capabilities: { review: {} }
		},
		{
			label: uncommittedChangesetLabel(),
			description: uncommittedChangesetDescription(),
			uriTemplate: buildUncommittedChangesetUri(sessionUri),
			changeKind: ChangesetKind.Uncommitted
		},
		{
			label: sessionChangesetLabel(),
			description: sessionChangesetDescription(),
			uriTemplate: buildSessionChangesetUri(sessionUri),
			changeKind: ChangesetKind.Session
		},
		{
			label: thisTurnChangesetLabel(),
			description: thisTurnChangesetDescription(),
			uriTemplate: buildTurnChangesetUriTemplate(sessionUri),
			changeKind: ChangesetKind.Turn
		},
		{
			label: compareTurnsChangesetLabel(),
			description: compareTurnsChangesetDescription(),
			uriTemplate: buildCompareTurnsChangesetUriTemplate(sessionUri),
			changeKind: ChangesetKind.Compare
		},
		...agentMergeChangeset
	] satisfies Changeset[];
}

function shouldAdvertiseAgentMergeChangeset(state: ISessionWithDefaultChat): boolean {
	if (readAgentMergeSessionState(state.config?.values)?.enabled === true
		|| state.changesets?.some(changeset => changeset.changeKind === AGENT_MERGE_CHANGESET_ID)) {
		return true;
	}

	return state.turns.some(turn =>
		(turn.message.origin.kind === MessageKind.SystemNotification && isAgentMergeMessage(turn.message))
		|| turn.responseParts.some(part =>
			part.kind === ResponsePartKind.SystemNotification
			&& readAgentSystemNotificationMeta(part).kind === AgentSystemNotificationKind.AgentMergeEnabled));
}
