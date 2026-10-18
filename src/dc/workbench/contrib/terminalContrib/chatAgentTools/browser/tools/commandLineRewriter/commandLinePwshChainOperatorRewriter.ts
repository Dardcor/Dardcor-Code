/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QueryCapture } from '@vscode/tree-sitter-wasm';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { isPowerShell } from '../../runInTerminalHelpers.js';
import type { TreeSitterCommandParser } from '../../treeSitterCommandParser.js';
import type { ICommandLineRewriter, ICommandLineRewriterOptions, ICommandLineRewriterResult } from './commandLineRewriter.js';

export class CommandLinePwshChainOperatorRewriter extends Disposable implements ICommandLineRewriter {
	constructor(
		private readonly _treeSitterCommandParser: TreeSitterCommandParser,
	) {
		super();
	}

	async rewrite(options: ICommandLineRewriterOptions): Promise<ICommandLineRewriterResult | undefined> {
		if (isPowerShell(options.shell, options.os)) {
			let doubleAmpersandCaptures: QueryCapture[] | undefined;
			try {
				doubleAmpersandCaptures = await this._treeSitterCommandParser.extractPwshDoubleAmpersandChainOperators(options.commandLine);
			} catch {
			}

			if (doubleAmpersandCaptures && doubleAmpersandCaptures.length > 0) {
				let rewritten = options.commandLine;
				for (const capture of doubleAmpersandCaptures.reverse()) {
					rewritten = `${rewritten.substring(0, capture.node.startIndex)};${rewritten.substring(capture.node.endIndex)}`;
				}
				return {
					rewritten,
					reasoning: '&& re-written to ;'
				};
			}

			if (options.commandLine.includes('&&') || /\bcd\s+\/d\b/i.test(options.commandLine)) {
				const rewritten = options.commandLine
					.replace(/\bcd\s+\/d\s+("[^"]+"|\S+)\s*(?:&&|;)\s*/gi, 'Set-Location $1; ')
					.replace(/\bcd\s+\/d\s+("[^"]+"|\S+)/gi, 'Set-Location $1')
					.replace(/\s*&&\s*/g, ' ; ');
				return {
					rewritten,
					reasoning: '&& re-written to ; (regex fallback)'
				};
			}
		}

		return undefined;
	}
}
