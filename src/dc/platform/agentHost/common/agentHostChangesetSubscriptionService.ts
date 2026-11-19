/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI as ProtocolURI } from './state/sessionState.js';
import type { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAgentHostChangesetSubscriptionService = createDecorator<IAgentHostChangesetSubscriptionService>('agentHostChangesetSubscriptionService');

export interface IAgentHostChangesetSubscriptionService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeSessionSubscriptions: Event<ProtocolURI>;

	getSessionSubscriptions(session: ProtocolURI): ReadonlySet<ProtocolURI>;

	addSubscription(session: ProtocolURI, changeset: ProtocolURI): void;

	removeSubscription(session: ProtocolURI, changeset: ProtocolURI): void;

	clearSessionSubscriptions(session: ProtocolURI): void;
}
