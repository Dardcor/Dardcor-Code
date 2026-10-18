/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMarketplacePlugin } from './pluginMarketplaceService.js';

export const IPluginInstallService = createDecorator<IPluginInstallService>('pluginInstallService');

export interface IUpdateAllPluginsOptions {
	readonly force?: boolean;

	readonly silent?: boolean;

	readonly marketplaceIds?: ReadonlySet<string>;

	readonly automatic?: boolean;
}

export interface IUpdateAllPluginsResult {
	readonly updatedNames: readonly string[];
	readonly failedNames: readonly string[];
}

export interface IInstallPluginFromSourceOptions {
	readonly plugin?: string;
}

export interface IInstallPluginFromSourceResult {
	readonly success: boolean;
	readonly message?: string;
	readonly matchedPlugin?: IMarketplacePlugin;
}

export interface IPluginInstallService {
	readonly _serviceBrand: undefined;

	installPlugin(plugin: IMarketplacePlugin): Promise<void>;

	installPluginFromSource(source: string, options?: IInstallPluginFromSourceOptions): Promise<IInstallPluginFromSourceResult>;

	validatePluginSource(source: string): string | undefined;

	updatePlugin(plugin: IMarketplacePlugin): Promise<boolean>;

	updateAllPlugins(options: IUpdateAllPluginsOptions, token: CancellationToken): Promise<IUpdateAllPluginsResult>;

	getPluginInstallUri(plugin: IMarketplacePlugin): URI;
}
