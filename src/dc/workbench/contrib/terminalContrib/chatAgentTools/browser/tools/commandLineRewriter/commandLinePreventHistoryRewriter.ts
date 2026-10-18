/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { isBash, isZsh } from '../../runInTerminalHelpers.js';
import { TerminalChatAgentToolsSettingId } from '../../../common/terminalChatAgentToolsConfiguration.js';
import type { ICommandLineRewriter, ICommandLineRewriterOptions, ICommandLineRewriterResult } from './commandLineRewriter.js';

export class CommandLinePreventHistoryRewriter extends Disposable implements ICommandLineRewriter {
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	rewrite(options: ICommandLineRewriterOptions): ICommandLineRewriterResult | undefined {
		const preventShellHistory = this._configurationService.getValue(TerminalChatAgentToolsSettingId.PreventShellHistory) === true;
		if (!preventShellHistory) {
			return undefined;
		}
		if (isBash(options.shell, options.os) || isZsh(options.shell, options.os)) {
			return {
				rewritten: ` ${options.commandLine}`,
				reasoning: 'Prepended with a space to exclude from shell history'
			};
		}
		return undefined;
	}
}
