/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../../../../base/common/platform.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TerminalChatAgentToolsSettingId } from '../../../common/terminalChatAgentToolsConfiguration.js';
import { isBash, isFish, isPowerShell, isZsh } from '../../runInTerminalHelpers.js';
import type { ICommandLineRewriter, ICommandLineRewriterOptions, ICommandLineRewriterResult } from './commandLineRewriter.js';

export class CommandLineBackgroundDetachRewriter extends Disposable implements ICommandLineRewriter {
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	rewrite(options: ICommandLineRewriterOptions): ICommandLineRewriterResult | undefined {
		if (!this._configurationService.getValue(TerminalChatAgentToolsSettingId.DetachBackgroundProcesses)) {
			return undefined;
		}

		const trimmedForCheck = options.commandLine.trimEnd();
		const endsWithBareBackgroundAmp = /(?:^|[^&])&$/.test(trimmedForCheck);
		if (!options.isBackground && !endsWithBareBackgroundAmp) {
			return undefined;
		}

		if (this._readsFromStdin(options.commandLine)) {
			return undefined;
		}

		if (options.os === OperatingSystem.Windows) {
			if (!options.isBackground) {
				return undefined;
			}
			return this._rewriteForPowerShell(options);
		}

		return this._rewriteForPosix(options);
	}

	private _readsFromStdin(commandLine: string): boolean {
		const trimmed = commandLine
			.replace(/^\s*(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, '')
			.replace(/^\s*cd\s+\S+\s*(?:&&|;)\s*/i, '')
			.trimStart();
		if (/^(expect|passwd|vi|vim|nano|less|more|top|htop|sftp|ftp|telnet|gdb|lldb)\b/.test(trimmed)) {
			return true;
		}
		if (/^psql\b/.test(trimmed) && !/\s(-c|-f|--command|--file)\b/.test(trimmed)) {
			return true;
		}
		if (/^mysql\b/.test(trimmed) && !/\s(-e|--execute)\b/.test(trimmed)) {
			return true;
		}
		if (/^ssh\b/.test(trimmed) && !/\s-T\b/.test(trimmed) && !/\sssh\s+\S+\s+\S/.test(' ' + trimmed)) {
			return true;
		}
		if (/^sudo\b/.test(trimmed) && !/\s-n\b/.test(trimmed) && !/\bSUDO_ASKPASS\b/.test(commandLine)) {
			return true;
		}
		return false;
	}

	private _rewriteForPosix(options: ICommandLineRewriterOptions): ICommandLineRewriterResult {
		const trimmed = options.commandLine.trimEnd();

		const endsWithBackgroundAmp = /(?:^|[^&])&$/.test(trimmed);

		let commandToWrap = trimmed;
		if (this._needsShellCWrapper(trimmed)) {
			const innerCommand = endsWithBackgroundAmp ? trimmed.replace(/\s*&$/, '') : trimmed;
			if (isFish(options.shell, options.os)) {
				const escaped = innerCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
				commandToWrap = `${options.shell} -c "${escaped}"`;
			} else {
				const escaped = innerCommand.replace(/'/g, `'\\''`);
				commandToWrap = `${options.shell} -c '${escaped}'`;
			}
		}

		const needsTrailingAmp = !(/(?:^|[^&])&$/.test(commandToWrap));

		const supportsDisown = isBash(options.shell, options.os) || isZsh(options.shell, options.os);
		const disownSuffix = supportsDisown ? ' disown' : '';

		const rewritten = needsTrailingAmp
			? `nohup ${commandToWrap} &${disownSuffix}`
			: `nohup ${commandToWrap}${disownSuffix}`;
		return {
			rewritten,
			reasoning: 'Wrapped background command with nohup to survive terminal shutdown',
			forDisplay: options.commandLine,
		};
	}

	private _needsShellCWrapper(commandLine: string): boolean {
		const trimmed = commandLine.trimStart();
		return (
			/^(for|while|until|if|case|select|function)\b/.test(trimmed) ||
			/^(eval|set|export|source|unset|declare|typeset|local|readonly|alias|cd|exec)\b/.test(trimmed) ||
			/^\.\s/.test(trimmed) ||
			/^[{(]/.test(trimmed) ||
			/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed) ||
			/(?:\|\||&&|[|;]|&(?!&)(?!\s*$))/.test(trimmed)
		);
	}

	private _rewriteForPowerShell(options: ICommandLineRewriterOptions): ICommandLineRewriterResult | undefined {
		if (!isPowerShell(options.shell, options.os)) {
			return undefined;
		}

		const escapedCommand = options.commandLine.replace(/"/g, '\\"');

		return {
			rewritten: `Start-Process -WindowStyle Hidden -FilePath "${options.shell}" -ArgumentList "-NoProfile", "-Command", "${escapedCommand}"`,
			reasoning: 'Wrapped background command with Start-Process to survive terminal shutdown',
			forDisplay: options.commandLine,
		};
	}
}
