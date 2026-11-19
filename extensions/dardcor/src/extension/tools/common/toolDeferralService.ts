/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDeferralService } from '../../../platform/networking/common/toolDeferralService';
import { ToolName } from './toolNames';
import { ToolRegistry } from './toolsRegistry';

const additionalNonDeferredToolNames = new Set<string>([
	ToolName.CoreRunInTerminal,
	ToolName.CoreGetTerminalOutput,
	ToolName.CoreSendToTerminal,
	ToolName.CoreKillTerminal,
	ToolName.CoreRunSubagent,
	ToolName.CoreRunTest,
	ToolName.CoreAskQuestions,
	ToolName.ToolSearch,
	'task_complete',
	'vscode_renameSymbol',
	'vscode_listCodeUsages',
]);

export class ToolDeferralService implements IToolDeferralService {
	readonly _serviceBrand: undefined;

	isNonDeferredTool(name: string): boolean {
		return ToolRegistry.nonDeferredToolNames.has(name) || additionalNonDeferredToolNames.has(name);
	}
}
