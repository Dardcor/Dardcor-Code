/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMarketplacePlugin, IMarketplaceReference, IPluginSourceDescriptor, MarketplaceType, PluginSourceKind } from './pluginMarketplaceService.js';
import { IPluginSource } from './pluginSource.js';

export const IAgentPluginRepositoryService = createDecorator<IAgentPluginRepositoryService>('agentPluginRepositoryService');

export interface IEnsureRepositoryOptions {
	readonly progressTitle?: string;
	readonly failureLabel?: string;
	readonly marketplaceType?: MarketplaceType;
	readonly refreshIfOlderThanMs?: number;
	readonly token?: CancellationToken;
}

export interface IPullRepositoryOptions {
	readonly pluginName?: string;
	readonly failureLabel?: string;
	readonly marketplaceType?: MarketplaceType;
	readonly silent?: boolean;
}

export interface IAgentPluginRepositoryService {
	readonly _serviceBrand: undefined;

	readonly agentPluginsHome: URI;

	getRepositoryUri(marketplace: IMarketplaceReference, marketplaceType?: MarketplaceType): URI;

	getPluginInstallUri(plugin: IMarketplacePlugin): URI;

	ensureRepository(marketplace: IMarketplaceReference, options?: IEnsureRepositoryOptions): Promise<URI>;

	pullRepository(marketplace: IMarketplaceReference, options?: IPullRepositoryOptions): Promise<boolean>;

	getPluginSourceInstallUri(sourceDescriptor: IPluginSourceDescriptor): URI;

	ensurePluginSource(plugin: IMarketplacePlugin, options?: IEnsureRepositoryOptions): Promise<URI>;

	updatePluginSource(plugin: IMarketplacePlugin, options?: IPullRepositoryOptions): Promise<boolean>;

	getPluginSource(kind: PluginSourceKind): IPluginSource;

	cleanupPluginSource(plugin: IMarketplacePlugin, otherInstalledDescriptors?: readonly IPluginSourceDescriptor[]): Promise<void>;

	fetchRepository(marketplace: IMarketplaceReference): Promise<boolean>;
}
