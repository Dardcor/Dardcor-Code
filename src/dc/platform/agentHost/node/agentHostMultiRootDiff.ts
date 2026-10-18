/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../base/common/network.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import type { ISessionFileDiff } from '../common/state/sessionState.js';


export function dedupeSessionFileDiffs(orderedDiffLists: readonly (readonly ISessionFileDiff[])[]): ISessionFileDiff[] {
	const merged: ISessionFileDiff[] = [];
	const seenKeys = new Set<string>();
	for (const diffs of orderedDiffLists) {
		for (const diff of diffs) {
			const id = diff.after?.uri ?? diff.before?.uri;
			if (!id) {
				continue;
			}
			const key = dedupeKeyForDiffId(id);
			if (seenKeys.has(key)) {
				continue;
			}
			seenKeys.add(key);
			merged.push(diff);
		}
	}
	return merged;
}

function dedupeKeyForDiffId(id: string): string {
	const resource = URI.parse(id);
	return resource.scheme === Schemas.file
		? extUriBiasedIgnorePathCase.getComparisonKey(resource)
		: id;
}

export type MultiRootDiffOutcome = 'complete' | 'partial' | 'failed';

export interface IMultiRootDiffEvaluation {
	readonly outcome: MultiRootDiffOutcome;
	readonly availableSources: readonly (readonly ISessionFileDiff[])[];
}

export function evaluateMultiRootDiffSources(orderedSources: readonly (readonly ISessionFileDiff[] | undefined)[]): IMultiRootDiffEvaluation {
	const availableSources = orderedSources.filter((source): source is readonly ISessionFileDiff[] => source !== undefined);
	let outcome: MultiRootDiffOutcome;
	if (availableSources.length === 0) {
		outcome = 'failed';
	} else if (availableSources.length === orderedSources.length) {
		outcome = 'complete';
	} else {
		outcome = 'partial';
	}
	return { outcome, availableSources };
}
