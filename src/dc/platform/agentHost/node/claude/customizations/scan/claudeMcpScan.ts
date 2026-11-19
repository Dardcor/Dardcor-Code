/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../files/common/files.js';
import { makeMcpServerCustomization, readJsonFile } from '../../../../../agentPlugins/common/pluginParsers.js';
import { McpServerStatus, type McpServerCustomization, type McpServerState } from '../../../../common/state/protocol/channels-session/state.js';

function claudeMcpFiles(workingDirectory: URI | undefined, userHome: URI): URI[] {
	const files: URI[] = [];
	if (workingDirectory) {
		files.push(URI.joinPath(workingDirectory, '.claude', 'settings.json'));
		files.push(URI.joinPath(workingDirectory, '.mcp.json'));
	}
	files.push(URI.joinPath(userHome, '.claude', 'settings.json'));
	return files;
}

function extractMcpServerMap(uri: URI, raw: unknown): Record<string, unknown> | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	if (Object.hasOwn(obj, 'mcpServers')) {
		const servers = obj.mcpServers;
		return (servers && typeof servers === 'object' && !Array.isArray(servers)) ? servers as Record<string, unknown> : undefined;
	}
	return uri.path.endsWith('.mcp.json') ? obj : undefined;
}

export async function scanClaudeMcpServers(
	workingDirectory: URI | undefined,
	userHome: URI,
	fileService: IFileService,
): Promise<readonly McpServerCustomization[]> {
	const seen = new Set<string>();
	const result: McpServerCustomization[] = [];
	for (const uri of claudeMcpFiles(workingDirectory, userHome)) {
		const raw = await readJsonFile(uri, fileService);
		const servers = extractMcpServerMap(uri, raw);
		if (!servers) {
			continue;
		}
		for (const [name, config] of Object.entries(servers)) {
			if (!config || typeof config !== 'object' || Array.isArray(config) || seen.has(name)) {
				continue;
			}
			seen.add(name);
			result.push(makeMcpServerCustomization(uri, name));
		}
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

export function deriveMcpState(status: string): McpServerState {
	switch (status) {
		case 'connected':
			return { kind: McpServerStatus.Ready };
		case 'disabled':
			return { kind: McpServerStatus.Stopped };
		default:
			return { kind: McpServerStatus.Starting };
	}
}
