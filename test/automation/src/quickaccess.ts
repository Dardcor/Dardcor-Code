/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Editors } from './editors';
import { Code } from './code';
import { QuickInput } from './quickinput';
import { basename, isAbsolute } from 'path';

enum QuickAccessKind {
	Files = 1,
	Commands,
	Symbols
}

export class QuickAccess {

	constructor(private code: Code, private editors: Editors, private quickInput: QuickInput) { }

	async openFileQuickAccessAndWait(searchValue: string, expectedFirstElementNameOrExpectedResultCount: string | number): Promise<void> {

		await this.runCommand('workbench.action.clearEditorHistoryWithoutConfirm');

		const PollingStrategy = {
			Stop: true,
			Continue: false
		};

		let retries = 0;
		let success = false;

		while (++retries < 10) {
			let retry = false;

			try {
				await this.openQuickAccessWithRetry(QuickAccessKind.Files, searchValue);
				await this.quickInput.waitForQuickInputElements(elementNames => {
					this.code.logger.log('QuickAccess: resulting elements: ', elementNames);

					if (elementNames.length === 0) {
						this.code.logger.log('QuickAccess: file search returned 0 elements, will continue polling...');

						return PollingStrategy.Continue;
					}

					const firstElementName = elementNames[0];
					if (firstElementName === 'No matching results') {
						this.code.logger.log(`QuickAccess: file search returned "No matching results", will retry...`);

						retry = true;

						return PollingStrategy.Stop;
					}

					if (typeof expectedFirstElementNameOrExpectedResultCount === 'number') {
						if (elementNames.length === expectedFirstElementNameOrExpectedResultCount) {
							success = true;

							return PollingStrategy.Stop;
						}

						this.code.logger.log(`QuickAccess: file search returned ${elementNames.length} results but was expecting ${expectedFirstElementNameOrExpectedResultCount}, will retry...`);

						retry = true;

						return PollingStrategy.Stop;
					}

					else {
						if (firstElementName === expectedFirstElementNameOrExpectedResultCount) {
							success = true;

							return PollingStrategy.Stop;
						}

						this.code.logger.log(`QuickAccess: file search returned ${firstElementName} as first result but was expecting ${expectedFirstElementNameOrExpectedResultCount}, will retry...`);

						retry = true;

						return PollingStrategy.Stop;
					}
				});
			} catch (error) {
				this.code.logger.log(`QuickAccess: file search waitForQuickInputElements threw an error ${error}, will retry...`);

				retry = true;
			}

			if (!retry) {
				break;
			}

			await this.quickInput.closeQuickInput();

			if (retries < 9) {
				await this.code.wait(250 * retries);
			}
		}

		if (!success) {
			if (typeof expectedFirstElementNameOrExpectedResultCount === 'string') {
				throw new Error(`Quick open file search was unable to find '${expectedFirstElementNameOrExpectedResultCount}' after 10 attempts, giving up.`);
			} else {
				throw new Error(`Quick open file search was unable to find ${expectedFirstElementNameOrExpectedResultCount} result items after 10 attempts, giving up.`);
			}
		}
	}

	async openFile(path: string): Promise<void> {
		if (!isAbsolute(path)) {
			throw new Error('QuickAccess.openFile requires an absolute path');
		}

		const fileName = basename(path);

		await this.openFileQuickAccessAndWait(path, basename(path));

		await this.quickInput.selectQuickInputElement(0);

		await this.editors.waitForEditorFocus(fileName);
	}

	private async openQuickAccessWithRetry(kind: QuickAccessKind, value?: string): Promise<void> {
		let retries = 0;

		while (retries < 5) {

			try {
				const accept = () => this.quickInput.waitForQuickInputOpened(10);
				switch (kind) {
					case QuickAccessKind.Files:
						await this.code.dispatchKeybinding(process.platform === 'darwin' ? 'cmd+p' : 'ctrl+p', accept);
						break;
					case QuickAccessKind.Symbols:
						await this.code.dispatchKeybinding(process.platform === 'darwin' ? 'cmd+shift+o' : 'ctrl+shift+o', accept);
						break;
					case QuickAccessKind.Commands:
						await this.code.dispatchKeybinding(process.platform === 'darwin' ? 'cmd+shift+p' : 'ctrl+shift+p', async () => {

							await this.code.wait(100);
							await this.quickInput.waitForQuickInputOpened(10);
						});
						break;
				}
				break;
			} catch (err) {
				if (++retries > 5) {
					throw new Error(`QuickAccess.openQuickAccessWithRetry(kind: ${kind}) failed: ${err}`);
				}

				await this.code.dispatchKeybinding('escape', async () => { });
			}
		}

		if (value) {
			await this.quickInput.type(value);
		}
	}

	async runCommand(commandId: string, options?: { keepOpen?: boolean; exactLabelMatch?: boolean }): Promise<void> {
		const keepOpen = options?.keepOpen;
		const exactLabelMatch = options?.exactLabelMatch;

		const openCommandPalletteAndTypeCommand = async (): Promise<boolean> => {
			await this.openQuickAccessWithRetry(QuickAccessKind.Commands, `>${commandId}`);

			await this.quickInput.waitForQuickInputElementFocused();

			const text = await this.quickInput.waitForQuickInputElementText();

			if (text === 'No matching commands' || (exactLabelMatch && text !== commandId)) {
				return false;
			}

			return true;
		};

		let hasCommandFound = await openCommandPalletteAndTypeCommand();

		if (!hasCommandFound) {

			this.code.logger.log(`QuickAccess: No matching commands, will retry...`);
			await this.quickInput.closeQuickInput();

			let retries = 0;
			while (++retries < 5) {
				hasCommandFound = await openCommandPalletteAndTypeCommand();
				if (hasCommandFound) {
					break;
				} else {
					this.code.logger.log(`QuickAccess: No matching commands, will retry...`);
					await this.quickInput.closeQuickInput();
					await this.code.wait(1000);
				}
			}

			if (!hasCommandFound) {
				throw new Error(`QuickAccess.runCommand(commandId: ${commandId}) failed to find command.`);
			}
		}

		let selectRetries = 0;
		while (true) {
			try {
				await this.quickInput.selectQuickInputElement(0, keepOpen);
				break;
			} catch (err) {
				if (++selectRetries > 3) {
					throw err;
				}
				this.code.logger.log(`QuickAccess.runCommand(commandId: ${commandId}): selectQuickInputElement failed (${err}), will retry...`);
				try {
					await this.quickInput.closeQuickInput();
				} catch {
				}
				const found = await openCommandPalletteAndTypeCommand();
				if (!found) {
					throw new Error(`QuickAccess.runCommand(commandId: ${commandId}) failed to find command on retry.`);
				}
			}
		}
	}

	async openQuickOutline(): Promise<void> {
		let retries = 0;

		while (++retries < 10) {

			await this.openQuickAccessWithRetry(QuickAccessKind.Symbols);

			const text = await this.quickInput.waitForQuickInputElementText();

			if (text === 'No symbol information for the file') {
				this.code.logger.log(`QuickAccess: openQuickOutline indicated 'No symbol information for the file', will retry...`);

				await this.quickInput.closeQuickInput();

				continue;
			}
		}
	}

	async getVisibleCommandNames(searchValue: string): Promise<string[]> {

		await this.openQuickAccessWithRetry(QuickAccessKind.Commands, `>${searchValue}`);

		let commandNames: string[] = [];
		await this.quickInput.waitForQuickInputElements(elementNames => {
			commandNames = elementNames;
			return true;
		});

		await this.quickInput.closeQuickInput();

		return commandNames;
	}
}
