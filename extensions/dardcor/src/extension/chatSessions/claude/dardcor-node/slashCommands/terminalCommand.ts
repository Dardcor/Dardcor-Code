/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { ILogService } from '../../../../../platform/log/common/logService';
import { CapturingToken } from '../../../../../platform/requestLogger/common/capturingToken';
import { ITerminalService } from '../../../../../platform/terminal/common/terminalService';
import { CancellationToken } from '../../../../../util/dardcor/base/common/cancellation';
import { generateUuid } from '../../../../../util/dardcor/base/common/uuid';
import { IInstantiationService } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ClaudeLanguageModelServer } from '../../node/claudeLanguageModelServer';
import { IClaudeSessionStateService } from '../../common/claudeSessionStateService';
import { IClaudeSlashCommandHandler, registerClaudeSlashCommand } from './claudeSlashCommandRegistry';

const execFileAsync = promisify(execFile);

export class TerminalSlashCommand implements IClaudeSlashCommandHandler {
	readonly commandName = 'terminal';
	readonly description = vscode.l10n.t('Launch Claude Code CLI using your Dardcor AI subscription');
	readonly commandId = 'dardcor.claude.terminal';

	private _langModelServer: ClaudeLanguageModelServer | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IClaudeSessionStateService private readonly sessionStateService: IClaudeSessionStateService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async handle(
		_args: string,
		stream: vscode.ChatResponseStream | undefined,
		_token: CancellationToken
	): Promise<vscode.ChatResult> {
		stream?.markdown(vscode.l10n.t('Creating Claude CLI instance...'));

		try {
			const cliCommand = await this._getClaudeCliCommand();
			if (!cliCommand) {
				const installUrl = 'https://code.claude.com';
				const downloadLabel = vscode.l10n.t('Download Claude CLI');
				if (stream) {
					stream.markdown(vscode.l10n.t('Claude CLI is not installed. Download Claude CLI to get started.'));
					stream.button({ command: 'vscode.open', arguments: [vscode.Uri.parse(installUrl)], title: downloadLabel });
				} else {
					vscode.window.showErrorMessage(
						vscode.l10n.t('Claude CLI is not installed.'),
						downloadLabel
					).then(selection => {
						if (selection === downloadLabel) {
							vscode.env.openExternal(vscode.Uri.parse(installUrl));
						}
					});
				}
				return {};
			}

			const server = await this._getLanguageModelServer();
			const config = server.getConfig();

			const sessionId = generateUuid();

			const terminal = this.terminalService.createTerminal({
				name: 'Claude',
				message: formatMessageForTerminal(vscode.l10n.t('This instance of Claude CLI is configured to use your Dardcor AI subscription.'), { loudFormatting: true }),
				env: {
					ANTHROPIC_BASE_URL: `http://localhost:${config.port}`,
					ANTHROPIC_AUTH_TOKEN: `${config.nonce}.${sessionId}`,
					CLAUDE_CODE_HIDE_ACCOUNT_INFO: '1',
				}
			});

			terminal.show();

			terminal.sendText(`${cliCommand} --session-id ${sessionId}`);

			this.sessionStateService.setCapturingTokenForSession(
				sessionId,
				new CapturingToken(`Claude CLI (${sessionId})`, 'claude')
			);

			this.logService.info(`[TerminalSlashCommand] Created terminal with Claude CLI configured on port ${config.port}, command: ${cliCommand}, sessionId: ${sessionId}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error('[TerminalSlashCommand] Error creating terminal:', error);
			if (stream) {
				stream.markdown(vscode.l10n.t('Error creating terminal: {0}', errorMessage));
			} else {
				vscode.window.showErrorMessage(vscode.l10n.t('Error creating terminal: {0}', errorMessage));
			}
		}

		return {};
	}

	private async _getClaudeCliCommand(): Promise<string | undefined> {
		const whichCommand = process.platform === 'win32' ? 'where' : 'which';

		if (await this._isCommandAvailable(whichCommand, 'claude')) {
			return 'claude';
		}

		if (await this._isCommandAvailable(whichCommand, 'agency')) {
			return 'agency claude';
		}

		return undefined;
	}

	private async _isCommandAvailable(whichCommand: string, command: string): Promise<boolean> {
		try {
			await execFileAsync(whichCommand, [command]);
			return true;
		} catch {
			return false;
		}
	}

	private async _getLanguageModelServer(): Promise<ClaudeLanguageModelServer> {
		if (!this._langModelServer) {
			this._langModelServer = this.instantiationService.createInstance(ClaudeLanguageModelServer);
			await this._langModelServer.start();
		}

		return this._langModelServer;
	}
}


export interface ITerminalFormatMessageOptions {
	excludeLeadingNewLine?: boolean;
	loudFormatting?: boolean;
}

export function formatMessageForTerminal(message: string, options: ITerminalFormatMessageOptions = {}): string {
	let result = '';
	if (!options.excludeLeadingNewLine) {
		result += '\r\n';
	}
	result += '\x1b[0m\x1b[7m * ';
	if (options.loudFormatting) {
		result += '\x1b[0;104m';
	} else {
		result += '\x1b[0m';
	}
	result += ` ${message} \x1b[0m\n\r`;
	return result;
}

registerClaudeSlashCommand(TerminalSlashCommand);
