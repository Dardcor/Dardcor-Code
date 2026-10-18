/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

export const APP_NODE_MODULES_ROOTS = ['node_modules.asar.unpacked', 'node_modules'] as const;

export function resolveAppModulePathSync(appRoot: string, ...segments: string[]): string {
	for (const root of APP_NODE_MODULES_ROOTS) {
		const candidate = path.join(appRoot, root, ...segments);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return path.join(appRoot, 'node_modules', ...segments);
}

export async function resolveAppModulePath(appRoot: string, ...segments: string[]): Promise<string> {
	for (const root of APP_NODE_MODULES_ROOTS) {
		const candidate = path.join(appRoot, root, ...segments);
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
		}
	}
	return path.join(appRoot, 'node_modules', ...segments);
}
