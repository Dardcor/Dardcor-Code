/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppResourcePath, nodeModulesAsarUnpackedPath, nodeModulesPath } from '../../../base/common/network.js';
import product from '../../product/common/product.js';

function hasUnpackedNodeModulesArchive(): boolean {
	return !!process.versions['electron'] && !!product.commit && !process.env['VSCODE_DEV'];
}

export function getAppNodeModulesPath(): AppResourcePath {
	return hasUnpackedNodeModulesArchive() ? nodeModulesAsarUnpackedPath : nodeModulesPath;
}

export function getAppNodeModulesDirName(): 'node_modules' | 'node_modules.asar.unpacked' {
	return hasUnpackedNodeModulesArchive() ? 'node_modules.asar.unpacked' : 'node_modules';
}
