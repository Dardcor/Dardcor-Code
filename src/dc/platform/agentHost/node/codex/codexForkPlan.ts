/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export type ForkBoundaryResolution =
	| { readonly resolved: true; readonly keepThroughIndex: number; readonly numTurnsToDrop: number }
	| { readonly resolved: false };

export function resolveForkBoundary(sourceTurnIds: readonly string[], codexTurnId: string, fallbackTurnIndex: number): ForkBoundaryResolution {
	const total = sourceTurnIds.length;
	let keepThroughIndex = sourceTurnIds.findIndex(id => id === codexTurnId);
	if (keepThroughIndex === -1) {
		keepThroughIndex = fallbackTurnIndex;
	}
	if (total > 0 && (keepThroughIndex < 0 || keepThroughIndex >= total)) {
		return { resolved: false };
	}
	const numTurnsToDrop = total > 0 ? Math.max(0, total - (keepThroughIndex + 1)) : 0;
	return { resolved: true, keepThroughIndex, numTurnsToDrop };
}

export type ForkedTurnIdMapEntry = readonly [hostTurnId: string, codexTurnId: string];

export function planForkedTurnIdMap(
	sourceTurnIds: readonly string[],
	forkedTurnIds: readonly string[],
	keepThroughIndex: number,
	hostTurnIdBySourceCodexId: ReadonlyMap<string, string> | undefined,
	turnIdMapping: ReadonlyMap<string, string> | undefined,
): ForkedTurnIdMapEntry[] {
	if (!turnIdMapping || turnIdMapping.size === 0) {
		return [];
	}
	const keptCount = Math.min(keepThroughIndex + 1, sourceTurnIds.length, forkedTurnIds.length);
	const entries: ForkedTurnIdMapEntry[] = [];
	for (let i = 0; i < keptCount; i++) {
		const sourceCodexId = sourceTurnIds[i];
		const oldHostId = hostTurnIdBySourceCodexId?.get(sourceCodexId) ?? sourceCodexId;
		const newHostId = turnIdMapping.get(oldHostId) ?? oldHostId;
		entries.push([newHostId, forkedTurnIds[i]]);
	}
	return entries;
}
