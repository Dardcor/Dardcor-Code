/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { ISessionFolderPickerDecision } from '../../common/state/sessionState.js';

export async function computeFolderPickerDecisionForRoots(
	workingDirectories: readonly URI[],
	hasSelectionCriteria: (workingDirectory: URI, token: CancellationToken) => Promise<boolean>,
	token: CancellationToken = CancellationToken.None,
): Promise<ISessionFolderPickerDecision | undefined> {
	if (workingDirectories.length <= 1) {
		return undefined;
	}
	const results = await Promise.all(workingDirectories.map(directory => hasSelectionCriteria(directory, token)));
	const qualifying = workingDirectories.filter((_, index) => results[index]);
	if (qualifying.length >= 2) {
		return { hidden: false };
	}
	if (qualifying.length === 1) {
		return { hidden: true, primary: qualifying[0].toString() };
	}
	return { hidden: true };
}
