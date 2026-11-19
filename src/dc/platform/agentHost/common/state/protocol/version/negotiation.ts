/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareProtocolVersions } from './registry.js';

function tryParseSemver(version: string): readonly [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) {
		return undefined;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function isCompatibleProtocolVersion(offered: string, current: string): boolean {
	const a = tryParseSemver(offered);
	const b = tryParseSemver(current);
	if (!a || !b) {
		return false;
	}
	if (a[0] !== b[0]) {
		return false;
	}
	if (a[0] === 0 && a[1] !== b[1]) {
		return false;
	}
	return compareProtocolVersions(offered, current) <= 0;
}

export function negotiateProtocolVersion(offered: readonly string[], current: string): string | undefined {
	let best: string | undefined;
	for (const v of offered) {
		if (!isCompatibleProtocolVersion(v, current)) {
			continue;
		}
		if (best === undefined || compareProtocolVersions(v, best) > 0) {
			best = v;
		}
	}
	return best;
}
