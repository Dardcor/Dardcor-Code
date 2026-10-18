/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem } from '../../../../../../../base/common/platform.js';
import { isPowerShell } from '../../runInTerminalHelpers.js';
import type { ICommandLinePresenter, ICommandLinePresenterOptions, ICommandLinePresenterResult } from './commandLinePresenter.js';

export class NodeCommandLinePresenter implements ICommandLinePresenter {
	present(options: ICommandLinePresenterOptions): ICommandLinePresenterResult | undefined {
		const commandLine = options.commandLine.forDisplay;
		const extractedNode = extractNodeCommand(commandLine, options.shell, options.os);
		if (extractedNode) {
			return {
				commandLine: extractedNode,
				language: 'javascript',
				languageDisplayName: 'Node.js',
			};
		}
		return undefined;
	}
}

export function extractNodeCommand(commandLine: string, shell: string, os: OperatingSystem): string | undefined {
	const doubleQuoteMatch = commandLine.match(/^node(?:js)?\s+(?:-e|--eval)\s+"(?<code>.+)"$/s);
	if (doubleQuoteMatch?.groups?.code) {
		let jsCode = doubleQuoteMatch.groups.code.trim();

		if (isPowerShell(shell, os)) {
			jsCode = jsCode.replace(/`"/g, '"');
		} else {
			jsCode = jsCode.replace(/\\"/g, '"');
		}

		return jsCode;
	}

	const singleQuoteMatch = commandLine.match(/^node(?:js)?\s+(?:-e|--eval)\s+'(?<code>.+)'$/s);
	if (singleQuoteMatch?.groups?.code) {
		return singleQuoteMatch.groups.code.trim();
	}

	return undefined;
}
