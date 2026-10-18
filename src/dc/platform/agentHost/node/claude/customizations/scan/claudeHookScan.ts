/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { ResourceSet } from '../../../../../../base/common/map.js';
import { IFileService } from '../../../../../files/common/files.js';
import { parseHooksJson, readJsonFile } from '../../../../../agentPlugins/common/pluginParsers.js';
import { type HookCustomization } from '../../../../common/state/protocol/channels-session/state.js';

function claudeHookFiles(workingDirectory: URI | undefined, userHome: URI): URI[] {
	const files: URI[] = [];
	if (workingDirectory) {
		files.push(URI.joinPath(workingDirectory, '.claude', 'settings.json'));
		files.push(URI.joinPath(workingDirectory, '.claude', 'settings.local.json'));
	}
	files.push(URI.joinPath(userHome, '.claude', 'settings.json'));
	return files;
}

export async function scanClaudeHooks(
	workingDirectory: URI | undefined,
	userHome: URI,
	fileService: IFileService,
): Promise<readonly HookCustomization[]> {
	const result: HookCustomization[] = [];
	const seen = new ResourceSet();
	for (const uri of claudeHookFiles(workingDirectory, userHome)) {
		if (seen.has(uri)) {
			continue;
		}
		seen.add(uri);
		const raw = await readJsonFile(uri, fileService);
		if (raw === undefined) {
			continue;
		}
		const groups = parseHooksJson(uri, raw, workingDirectory, userHome);
		if (groups.length > 0) {
			result.push(groups[0].customization);
		}
	}
	return result;
}
