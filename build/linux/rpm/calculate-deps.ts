/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { constants, statSync } from 'fs';
import { additionalDeps } from './dep-lists.ts';

export function generatePackageDeps(files: string[]): Set<string>[] {
	const dependencies: Set<string>[] = files.map(file => calculatePackageDeps(file));
	const additionalDepsSet = new Set(additionalDeps);
	dependencies.push(additionalDepsSet);
	return dependencies;
}

// Based on https://source.chromium.org/chromium/chromium/src/+/main:chrome/installer/linux/rpm/calculate_package_deps.py.
function calculatePackageDeps(binaryPath: string): Set<string> {
	try {
		const st = statSync(binaryPath);
		if (!(st.mode & constants.S_IXUSR)) {
			console.warn(`Binary ${binaryPath} does not have executable bit set. Skipping.`);
			return new Set();
		}
	} catch (e) {
		console.warn(`Cannot stat ${binaryPath}, skipping.`);
		return new Set();
	}

	const findRequiresResult = spawnSync('/usr/lib/rpm/find-requires', { input: binaryPath + '\n' });
	if (findRequiresResult.status !== 0) {
		console.warn(`find-requires warning for ${binaryPath} (exit ${findRequiresResult.status}):\n${findRequiresResult.stderr}`);
		return new Set();
	}

	const requires = new Set(findRequiresResult.stdout.toString('utf-8').trimEnd().split('\n'));
	return requires;
}
