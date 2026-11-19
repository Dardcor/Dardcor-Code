/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { URI } from '../../../util/dardcor/base/common/uri';

export interface FileTree {
	[name: string]: string | FileTree | undefined;
}

export interface IChatDiskSessionResources {
	readonly _serviceBrand: undefined;

	ensure(sessionId: string, subdir: string, files: string | FileTree): Promise<URI>;

	isSessionResourceUri(uri: URI): boolean;
}

export const IChatDiskSessionResources = createServiceIdentifier<IChatDiskSessionResources>('IChatDiskSessionResources');
