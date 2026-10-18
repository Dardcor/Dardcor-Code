/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../../../../base/common/platform.js';
import { extractCdPrefix } from '../../runInTerminalHelpers.js';
import type { ICommandLineRewriter, ICommandLineRewriterOptions, ICommandLineRewriterResult } from './commandLineRewriter.js';

export class CommandLineCdPrefixRewriter extends Disposable implements ICommandLineRewriter {
	rewrite(options: ICommandLineRewriterOptions): ICommandLineRewriterResult | undefined {
		if (!options.cwd) {
			return undefined;
		}

		const extracted = extractCdPrefix(options.commandLine, options.shell, options.os);
		if (extracted) {
			let cdDirPath = extracted.directory.replace(/(?:[\\\/])$/, '');
			let cwdFsPath = options.cwd.fsPath.replace(/(?:[\\\/])$/, '');
			if (options.os === OperatingSystem.Windows) {
				cdDirPath = cdDirPath.toLowerCase();
				cwdFsPath = cwdFsPath.toLowerCase();
			}
			if (cdDirPath === cwdFsPath) {
				return { rewritten: extracted.command, reasoning: 'Removed redundant cd command' };
			}
		}
		return undefined;
	}
}
