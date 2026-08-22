/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogger } from '../../../../../platform/log/common/logService';
import { ICopilotCLISessionTracker } from '../dardcorCLISessionTracker';
import { InProcHttpServer } from '../inProcHttpServer';
import { sendEditorContextToSession, sendUriToSession } from './sendContext';

export const ADD_FILE_REFERENCE_COMMAND = 'github.dardcor.chat.dardcorCLI.addFileReference';

export function registerAddFileReferenceCommand(logger: ILogger, httpServer: InProcHttpServer, sessionTracker: ICopilotCLISessionTracker): vscode.Disposable {
	return vscode.commands.registerCommand(ADD_FILE_REFERENCE_COMMAND, async (uri?: vscode.Uri) => {
		logger.debug('Add file reference command executed');

		if (uri) {
			await sendUriToSession(logger, httpServer, sessionTracker, uri);
		} else {
			await sendEditorContextToSession(logger, httpServer, sessionTracker);
		}
	});
}
