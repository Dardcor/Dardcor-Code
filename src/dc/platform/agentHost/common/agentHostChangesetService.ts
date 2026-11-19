/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { IAgentHostClientTelemetryContext } from './agentHostTelemetry.js';
import type { ChangesSummary } from './state/protocol/state.js';
import type { ISessionFileDiff, URI as ProtocolURI } from './state/sessionState.js';

export const META_CHANGESET_BRANCH = 'agentHost.changeset.branch';

export const META_CHANGESET_SESSION = 'agentHost.changeset.session';

export const META_LEGACY_DIFFS = 'diffs';

export const META_CHANGES_SUMMARY = 'agentHost.changes';

export const CHANGESET_DB_METADATA_KEYS: Record<string, true> = {
	[META_CHANGESET_BRANCH]: true,
	[META_CHANGESET_SESSION]: true,
	[META_CHANGES_SUMMARY]: true,
	[META_LEGACY_DIFFS]: true,
};

export const CHANGES_SUMMARY_METADATA_KEYS: Record<string, true> = {
	[META_CHANGES_SUMMARY]: true,
};

export type StaticChangesetKind = 'branch' | 'session';

export interface IPersistedChangesetMetadata {
	readonly branchRaw?: string;
	readonly sessionRaw?: string;
	readonly legacyRaw?: string;
}

export interface IRestoredChangesetDiffs {
	readonly branch?: readonly ISessionFileDiff[];
	readonly session?: readonly ISessionFileDiff[];
}

export const IAgentHostChangesetService = createDecorator<IAgentHostChangesetService>('agentHostChangesetService');

export interface IAgentHostChangesetService {
	readonly _serviceBrand: undefined;

	registerStaticChangesets(session: ProtocolURI): void;

	restoreStaticChangeset(session: ProtocolURI, kind: StaticChangesetKind, diffs: readonly ISessionFileDiff[]): void;

	parsePersistedStaticChangesets(sessionUri: ProtocolURI, metadata: IPersistedChangesetMetadata): IRestoredChangesetDiffs;

	applyPersistedStaticChangesets(sessionUri: ProtocolURI, diffs: IRestoredChangesetDiffs): void;

	restorePersistedStaticChangesets(sessionUri: ProtocolURI, metadata: IPersistedChangesetMetadata): IRestoredChangesetDiffs;

	persistChangesSummary(sessionUri: ProtocolURI, summary: ChangesSummary): void;

	getListMetadataKeys(sessionUri: ProtocolURI): Record<string, true> | undefined;

	computeListEntryChanges(sessionUri: ProtocolURI, metadata: Record<string, string | undefined>): ChangesSummary | undefined;

	isStaticChangesetComputeActive(changesetUri: ProtocolURI): boolean;

	refreshChangesetCatalog(session: ProtocolURI): void;

	refreshBranchChangeset(session: ProtocolURI): void;

	refreshSessionChangeset(session: ProtocolURI): void;

	onWorkingDirectoryAvailable(session: ProtocolURI): void;

	recomputeSubscribedChangesets(session: ProtocolURI): void;

	computeTurnChangeset(session: ProtocolURI, turnId: string): Promise<ProtocolURI>;

	computeCompareTurnsChangeset(session: ProtocolURI, originalTurnId: string, modifiedTurnId: string): Promise<ProtocolURI>;

	computeUncommittedChangeset(session: ProtocolURI): Promise<ProtocolURI>;

	onToolCallEditsApplied(session: ProtocolURI, turnId: string, clientContext?: IAgentHostClientTelemetryContext): void;

	onTurnComplete(session: ProtocolURI, turnId: string | undefined, clientContext?: IAgentHostClientTelemetryContext): void;

	onSessionTruncated(session: ProtocolURI): void;

}
