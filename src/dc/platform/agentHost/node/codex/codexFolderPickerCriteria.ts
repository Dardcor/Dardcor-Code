/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../files/common/files.js';

export async function codexDirectoryHasHooks(fileService: IFileService, workingDirectory: URI, _token: CancellationToken = CancellationToken.None): Promise<boolean> {
	return fileService.exists(joinPath(workingDirectory, '.codex', 'hooks.json'));
}
