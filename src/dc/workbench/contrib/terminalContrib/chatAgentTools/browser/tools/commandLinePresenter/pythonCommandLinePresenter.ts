/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem } from '../../../../../../../base/common/platform.js';
import { isPowerShell } from '../../runInTerminalHelpers.js';
import type { ICommandLinePresenter, ICommandLinePresenterOptions, ICommandLinePresenterResult } from './commandLinePresenter.js';

export class PythonCommandLinePresenter implements ICommandLinePresenter {
	present(options: ICommandLinePresenterOptions): ICommandLinePresenterResult | undefined {
		const commandLine = options.commandLine.forDisplay;
		const extractedPython = extractPythonCommand(commandLine, options.shell, options.os);
		if (extractedPython) {
			return {
				commandLine: extractedPython,
				language: 'python',
				languageDisplayName: 'Python',
			};
		}
		return undefined;
	}
}

export function extractPythonCommand(commandLine: string, shell: string, os: OperatingSystem): string | undefined {
	const doubleQuoteMatch = commandLine.match(/^python(?:3)?\s+-c\s+"(?<python>.+)"$/s);
	if (doubleQuoteMatch?.groups?.python) {
		let pythonCode = doubleQuoteMatch.groups.python.trim();

		if (isPowerShell(shell, os)) {
			pythonCode = pythonCode.replace(/`"/g, '"');
		} else {
			pythonCode = pythonCode.replace(/\\"/g, '"');
		}

		return pythonCode;
	}

	const singleQuoteMatch = commandLine.match(/^python(?:3)?\s+-c\s+'(?<python>.+)'$/s);
	if (singleQuoteMatch?.groups?.python) {
		return singleQuoteMatch.groups.python.trim();
	}

	return undefined;
}
