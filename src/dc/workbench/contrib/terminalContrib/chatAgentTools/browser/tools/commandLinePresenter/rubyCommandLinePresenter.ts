/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem } from '../../../../../../../base/common/platform.js';
import { isPowerShell } from '../../runInTerminalHelpers.js';
import type { ICommandLinePresenter, ICommandLinePresenterOptions, ICommandLinePresenterResult } from './commandLinePresenter.js';

export class RubyCommandLinePresenter implements ICommandLinePresenter {
	present(options: ICommandLinePresenterOptions): ICommandLinePresenterResult | undefined {
		const commandLine = options.commandLine.forDisplay;
		const extractedRuby = extractRubyCommand(commandLine, options.shell, options.os);
		if (extractedRuby) {
			return {
				commandLine: extractedRuby,
				language: 'ruby',
				languageDisplayName: 'Ruby',
			};
		}
		return undefined;
	}
}

export function extractRubyCommand(commandLine: string, shell: string, os: OperatingSystem): string | undefined {
	const doubleQuoteMatch = commandLine.match(/^ruby\s+-e\s+"(?<code>.+)"$/s);
	if (doubleQuoteMatch?.groups?.code) {
		let rubyCode = doubleQuoteMatch.groups.code.trim();

		if (!rubyCode) {
			return undefined;
		}

		if (isPowerShell(shell, os)) {
			rubyCode = rubyCode.replace(/`"/g, '"');
		} else {
			rubyCode = rubyCode.replace(/\\"/g, '"');
		}

		return rubyCode;
	}

	const singleQuoteMatch = commandLine.match(/^ruby\s+-e\s+'(?<code>.+)'$/s);
	if (singleQuoteMatch?.groups?.code) {
		const rubyCode = singleQuoteMatch.groups.code.trim();

		if (!rubyCode) {
			return undefined;
		}

		return rubyCode;
	}

	return undefined;
}
