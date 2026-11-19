/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IEnsureRepositoryOptions, IPullRepositoryOptions } from './agentPluginRepositoryService.js';
import { IMarketplacePlugin, IPluginSourceDescriptor, PluginSourceKind } from './pluginMarketplaceService.js';

export interface IPluginSource {
	readonly kind: PluginSourceKind;

	getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI;

	ensure(cacheRoot: URI, plugin: IMarketplacePlugin, options?: IEnsureRepositoryOptions): Promise<URI>;

	update(cacheRoot: URI, plugin: IMarketplacePlugin, options?: IPullRepositoryOptions): Promise<boolean>;

	getCleanupTarget(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI | undefined;

	getLabel(descriptor: IPluginSourceDescriptor): string;

	runInstall?(installDir: URI, pluginDir: URI, plugin: IMarketplacePlugin, options?: { silent?: boolean }): Promise<{ pluginDir: URI } | undefined>;
}
