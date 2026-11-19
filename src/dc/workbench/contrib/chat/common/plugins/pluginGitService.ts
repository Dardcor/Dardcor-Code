/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IPluginGitService = createDecorator<IPluginGitService>('pluginGitService');

export interface IPluginGitService {
	readonly _serviceBrand: undefined;

	cloneRepository(cloneUrl: string, targetDir: URI, ref?: string, token?: CancellationToken): Promise<void>;
	pull(repoDir: URI, token?: CancellationToken): Promise<boolean>;
	checkout(repoDir: URI, treeish: string, detached?: boolean, token?: CancellationToken): Promise<void>;
	checkoutCommit(repoDir: URI, commit: string, token?: CancellationToken): Promise<void>;
	revParse(repoDir: URI, ref: string): Promise<string>;
	fetch(repoDir: URI, token?: CancellationToken): Promise<void>;
	fetchRepository(repoDir: URI, token?: CancellationToken): Promise<void>;
	revListCount(repoDir: URI, fromRef: string, toRef: string): Promise<number>;
}
