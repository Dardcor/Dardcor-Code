/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Random } from '../../../src/platform/inlineEdits/test/node/random';
import { LogEntry } from '../../../src/platform/workspaceRecorder/common/workspaceLog';
import { assertNever } from '../../../src/util/dardcor/base/common/assert';
import { PivotStrategy } from '../../base/simulationOptions';

export function selectPivots(entries: readonly LogEntry[], strategy: PivotStrategy, rng: Random): number[] {
	switch (strategy) {
		case PivotStrategy.Random:
			return selectRandomPivot(entries, rng);
		default:
			return assertNever(strategy);
	}
}

function selectRandomPivot(entries: readonly LogEntry[], rng: Random): number[] {
	const candidates = eligiblePivotIndices(entries);
	if (candidates.length === 0) {
		return [];
	}
	const idx = candidates[rng.nextIntRange(0, candidates.length)];
	return [entryTime(entries[idx])!];
}

function eligiblePivotIndices(entries: readonly LogEntry[]): number[] {
	const n = entries.length;
	const eligible: number[] = [];
	if (n < 2) {
		return eligible;
	}

	const encounteredIds = new Set<number>();
	const lastChangedIdxForId = new Map<number, number>();
	const timeFrequency = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		const entry = entries[i];
		if (entry.kind === 'documentEncountered') {
			encounteredIds.add(entry.id);
		} else if (entry.kind === 'changed') {
			lastChangedIdxForId.set(entry.id, i);
		}

		const time = entryTime(entry);
		if (time !== undefined) {
			timeFrequency.set(time, (timeFrequency.get(time) ?? 0) + 1);
		}
	}

	for (let i = 0; i < n - 1; i++) {
		const entry = entries[i];
		if (entry.kind !== 'changed' && entry.kind !== 'selectionChanged') {
			continue;
		}
		if (timeFrequency.get(entry.time) !== 1) {
			continue;
		}
		if (!encounteredIds.has(entry.id)) {
			continue;
		}
		const lastChangedIdx = lastChangedIdxForId.get(entry.id);
		if (lastChangedIdx === undefined || lastChangedIdx <= i) {
			continue;
		}
		eligible.push(i);
	}

	return eligible;
}

function entryTime(entry: LogEntry): number | undefined {
	return 'time' in entry ? entry.time : undefined;
}

export function deriveSeed(baseSeed: number, index: number): number {
	let h = (baseSeed ^ (index + 0x9e3779b9)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
	h = (h ^ (h >>> 15)) >>> 0;
	return h;
}
