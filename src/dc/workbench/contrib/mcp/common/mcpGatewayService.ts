/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IWorkbenchMcpGatewayService = createDecorator<IWorkbenchMcpGatewayService>('IWorkbenchMcpGatewayService');

export interface IMcpGatewayResultServer {
	readonly label: string;
	readonly address: URI;
}

export interface IMcpGatewayResult extends IDisposable {
	readonly servers: readonly IMcpGatewayResultServer[];

	readonly onDidChangeServers: Event<readonly IMcpGatewayResultServer[]>;
}

export interface IWorkbenchMcpGatewayService {
	readonly _serviceBrand: undefined;

	createGateway(inRemote: boolean, chatSessionResource?: URI): Promise<IMcpGatewayResult | undefined>;
}
