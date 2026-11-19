/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { ITunnelHostInfo } from '../../../../platform/agentHost/common/tunnelAgentHost.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ITunnelHostService = createDecorator<ITunnelHostService>('tunnelHostService');

export interface ITunnelHostService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeStatus: Event<void>;

	readonly isSharing: boolean;

	readonly isConnecting: boolean;

	readonly sharingInfo: ITunnelHostInfo | undefined;

	startSharing(): Promise<void>;

	stopSharing(): Promise<void>;
}
