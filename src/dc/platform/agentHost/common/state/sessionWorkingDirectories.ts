/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { extUri, extUriBiasedIgnorePathCase } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ActionType, type SessionWorkingDirectoryAction } from './sessionActions.js';

function areDirectorySetsEqual(first: readonly URI[], second: readonly URI[]): boolean {
	const toKey = (directory: URI) => extUri.getComparisonKey(directory);
	const firstSet = new ResourceSet(first, toKey);
	const secondSet = new ResourceSet(second, toKey);
	return firstSet.size === secondSet.size && [...firstSet].every(directory => secondSet.has(directory));
}

export function areAdditionalWorkingDirectoriesEqual(first: readonly URI[] | undefined, second: readonly URI[] | undefined): boolean {
	if (!first || !second) {
		return first === second;
	}
	return areDirectorySetsEqual(first, second);
}

export function areSessionWorkingDirectoriesEqual(first: readonly URI[] | undefined, second: readonly URI[] | undefined, hasImmutablePrimary: boolean): boolean {
	if (!first || !second) {
		return first === second;
	}
	if (!hasImmutablePrimary) {
		return areDirectorySetsEqual(first, second);
	}
	return extUri.isEqual(first[0], second[0])
		&& areDirectorySetsEqual(first.slice(1), second.slice(1));
}

export interface ISessionWorkingDirectoryCapability {
	readonly immutablePrimary: boolean;
	readonly primaryReplacement: boolean;
}

export function resolveSessionWorkingDirectoryAction(
	action: SessionWorkingDirectoryAction,
	workingDirectories: readonly string[],
	capability: ISessionWorkingDirectoryCapability,
): SessionWorkingDirectoryAction {
	const directory = URI.parse(action.directory, true);
	if (directory.scheme !== Schemas.file) {
		throw new Error(`Working directory must be a file URI: ${action.directory}`);
	}

	const current = workingDirectories.map(value => URI.parse(value, true));
	const index = current.findIndex(value => extUriBiasedIgnorePathCase.isEqual(value, directory));
	const canonicalDirectory = index >= 0 ? current[index] : directory;

	if (action.type === ActionType.SessionWorkingDirectoryRemoved) {
		if (index === 0 && (capability.immutablePrimary || capability.primaryReplacement)) {
			throw new Error('The primary working directory cannot be removed.');
		}
		return { ...action, directory: canonicalDirectory.toString() };
	}

	if (action.type === ActionType.SessionWorkingDirectoryReplaced) {
		const replacement = URI.parse(action.replacement, true);
		if (replacement.scheme !== Schemas.file) {
			throw new Error(`Working directory replacement must be a file URI: ${action.replacement}`);
		}
		if (index === 0 && capability.immutablePrimary && !capability.primaryReplacement) {
			throw new Error('The primary working directory cannot be replaced.');
		}
		const replacementIdx = current.findIndex(value => extUriBiasedIgnorePathCase.isEqual(value, replacement));
		const canonicalReplacement = replacementIdx >= 0 ? current[replacementIdx] : replacement;
		return { ...action, directory: canonicalDirectory.toString(), replacement: canonicalReplacement.toString() };
	}

	return { ...action, directory: canonicalDirectory.toString() };
}
