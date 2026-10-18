/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { getRemoteNodeVersion } from './util.ts';

const root = path.dirname(path.dirname(import.meta.dirname));
const { nodeVersion: version } = getRemoteNodeVersion();

const platform = process.platform;
const arch = process.arch;

const node = platform === 'win32' ? 'node.exe' : 'node';
const nodePath = path.join(root, '.build', 'node', `v${version}`, `${platform}-${arch}`, node);

console.log(nodePath);
