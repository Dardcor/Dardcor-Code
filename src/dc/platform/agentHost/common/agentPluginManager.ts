/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { ClientPluginCustomization, PluginCustomization } from './state/sessionState.js';

export const IAgentPluginManager = createDecorator<IAgentPluginManager>('agentPluginManager');

export interface ISyncedCustomization {
	readonly customization: PluginCustomization;
	readonly pluginDir?: URI;
}

export interface IAgentPluginManager {
	readonly _serviceBrand: undefined;

	readonly basePath: URI;

	syncCustomizations(clientId: string, customizations: ClientPluginCustomization[], progress?: (status: PluginCustomization) => void): Promise<ISyncedCustomization[]>;
}
