/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';

export interface IReleaseNotesService {
	readonly _serviceBrand: undefined;
	fetchLatestReleaseNotes(): Promise<string | undefined>;
	fetchReleaseNotesForVersion(version: string): Promise<string | undefined>;
}

export const IReleaseNotesService = createServiceIdentifier<IReleaseNotesService>('releaseNotesService');
