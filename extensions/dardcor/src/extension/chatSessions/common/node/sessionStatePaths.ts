/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'os';
import { join } from 'path';

const DARDCOR_HOME_DIRECTORY = '.dardcor';

export function getDardcorHome(): string {
	return process.env['DARDCOR_HOME'] || join(homedir(), DARDCOR_HOME_DIRECTORY);
}

export function getDardcorSessionDir(sessionId: string): string {
	return join(getDardcorHome(), 'session-state', sessionId);
}

export function getDardcorBulkMetadataFile(): string {
	return join(getDardcorHome(), 'vscode.session.metadata.cache.json');
}
