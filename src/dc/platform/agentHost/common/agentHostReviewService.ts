/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import type { URI as ProtocolURI } from './state/sessionState.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAgentHostReviewService = createDecorator<IAgentHostReviewService>('agentHostReviewService');

export function buildReviewedRefName(sanitizedSessionId: string): string {
	return `refs/agents/${sanitizedSessionId}/reviewed`;
}

export interface IAgentHostReviewService {
	readonly _serviceBrand: undefined;

	setReviewState(channel: ProtocolURI, resources: readonly ProtocolURI[], reviewed: boolean): Promise<void>;

	markFileReviewed(session: ProtocolURI, workingDirectory: URI, baseBranch: string | undefined, resource: URI): Promise<void>;

	markFileUnreviewed(session: ProtocolURI, workingDirectory: URI, baseBranch: string | undefined, resource: URI): Promise<void>;

	getReviewedPaths(session: ProtocolURI, workingDirectory: URI, baseBranch: string | undefined): Promise<ReadonlySet<string>>;

	copyReviewedRef(sourceSession: ProtocolURI, targetSession: ProtocolURI, workingDirectory: URI): Promise<void>;
}

export const NULL_REVIEW_SERVICE: IAgentHostReviewService = {
	_serviceBrand: undefined,
	setReviewState: async () => { },
	markFileReviewed: async () => { },
	markFileUnreviewed: async () => { },
	getReviewedPaths: async () => new Set(),
	copyReviewedRef: async () => { },
};
