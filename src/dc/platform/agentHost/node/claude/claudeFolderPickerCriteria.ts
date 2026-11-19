/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createCancelablePromise, firstParallel } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../files/common/files.js';
import { parseHooksJson, readJsonFile } from '../../../agentPlugins/common/pluginParsers.js';

export async function claudeDirectoryQualifiesForPrimary(fileService: IFileService, workingDirectory: URI, userHome: URI, token: CancellationToken = CancellationToken.None): Promise<boolean> {
	const probes: Array<() => Promise<boolean>> = [
		() => fileService.exists(joinPath(workingDirectory, '.mcp.json')),
		...['settings.json', 'settings.local.json'].map(fileName => {
			const uri = joinPath(workingDirectory, '.claude', fileName);
			return async (): Promise<boolean> => {
				const json = await readJsonFile(uri, fileService);
				return json !== undefined && parseHooksJson(uri, json, workingDirectory, userHome).length > 0;
			};
		}),
	];
	const running = probes.map(probe => createCancelablePromise(() => probe()));
	const abort = token.onCancellationRequested(() => running.forEach(probe => probe.cancel()));
	try {
		return (await firstParallel(running, qualifies => qualifies, false)) ?? false;
	} finally {
		abort.dispose();
	}
}
