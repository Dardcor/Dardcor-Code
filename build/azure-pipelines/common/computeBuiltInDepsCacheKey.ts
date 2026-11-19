/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCurrentExtensionTarget } from '../../lib/extensionTarget.ts';

const productjson = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../product.json'), 'utf8'));
const shasum = crypto.createHash('sha256');

const hasPlatformSpecific = (productjson.builtInExtensions as { platformSpecific?: unknown }[]).some(ext => ext.platformSpecific);
const target = hasPlatformSpecific ? getCurrentExtensionTarget() : undefined;
if (target) {
	shasum.update(`target:${target}`);
}

for (const ext of productjson.builtInExtensions) {
	shasum.update(`${ext.name}@${ext.version}`);
	if (ext.platformSpecific && target && ext.platformSpecific[target]) {
		shasum.update(`:${ext.platformSpecific[target]}`);
	}
}

process.stdout.write(shasum.digest('hex'));
