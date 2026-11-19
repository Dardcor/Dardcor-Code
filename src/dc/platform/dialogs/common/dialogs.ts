/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { basename } from '../../../base/common/resources.js';
import Severity from '../../../base/common/severity.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ITelemetryData } from '../../telemetry/common/telemetry.js';

export interface IDialogArgs {
	readonly confirmArgs?: IConfirmDialogArgs;
	readonly inputArgs?: IInputDialogArgs;
	readonly promptArgs?: IPromptDialogArgs;
}

export interface IBaseDialogOptions {
	readonly type?: Severity | DialogType;

	readonly title?: string;
	readonly message: string;

	readonly detail?: string | IMarkdownString;

	readonly checkbox?: ICheckbox;

	readonly custom?: boolean | ICustomDialogOptions;

	readonly token?: CancellationToken;
}

export interface IConfirmDialogArgs {
	readonly confirmation: IConfirmation;
}

export interface IConfirmation extends IBaseDialogOptions {

	readonly primaryButton?: string;

	readonly cancelButton?: string;
}

export interface IConfirmationResult extends ICheckboxResult {

	readonly confirmed: boolean;
}

export interface IInputDialogArgs {
	readonly input: IInput;
}

export interface IInput extends IConfirmation {
	readonly inputs: IInputElement[];

	readonly primaryButton?: string;
}

export interface IInputElement {
	readonly type?: 'text' | 'password';
	readonly value?: string;
	readonly placeholder?: string;
}

export interface IInputResult extends IConfirmationResult {

	readonly values?: string[];
}

export interface IPromptDialogArgs {
	readonly prompt: IPrompt<unknown>;
}

export interface IPromptBaseButton<T> {

	run(checkbox: ICheckboxResult): T | Promise<T>;
}

export interface IPromptButton<T> extends IPromptBaseButton<T> {
	readonly label: string;
}

export interface IPromptCancelButton<T> extends IPromptBaseButton<T> {

	readonly label?: string;
}

export interface IPrompt<T> extends IBaseDialogOptions {

	readonly buttons?: IPromptButton<T>[];

	readonly cancelButton?: IPromptCancelButton<T> | true | string;
}

export interface IPromptWithCustomCancel<T> extends IPrompt<T> {
	readonly cancelButton: IPromptCancelButton<T>;
}

export interface IPromptWithDefaultCancel<T> extends IPrompt<T> {
	readonly cancelButton: true | string;
}

export interface IPromptResult<T> extends ICheckboxResult {

	readonly result?: T;
}

export interface IPromptResultWithCancel<T> extends IPromptResult<T> {
	readonly result: T;
}

export interface IAsyncPromptResult<T> extends ICheckboxResult {

	readonly result?: Promise<T>;
}

export interface IAsyncPromptResultWithCancel<T> extends IAsyncPromptResult<T> {
	readonly result: Promise<T>;
}

export type IDialogResult = IConfirmationResult | IInputResult | IAsyncPromptResult<unknown>;

export type DialogType = 'none' | 'info' | 'error' | 'question' | 'warning';

export interface ICheckbox {
	readonly label: string;
	readonly checked?: boolean;
}

export interface ICheckboxResult {

	readonly checkboxChecked?: boolean;
}

export interface IPickAndOpenOptions {
	readonly forceNewWindow?: boolean;
	defaultUri?: URI;
	readonly telemetryExtraData?: ITelemetryData;
	availableFileSystems?: string[];
	remoteAuthority?: string | null;
}

export interface FileFilter {
	readonly extensions: string[];
	readonly name: string;
}

export interface ISaveDialogOptions {

	title?: string;

	defaultUri?: URI;

	filters?: FileFilter[];

	readonly saveLabel?: { readonly withMnemonic: string; readonly withoutMnemonic: string } | string;

	availableFileSystems?: readonly string[];
}

export interface IOpenDialogOptions {

	readonly title?: string;

	defaultUri?: URI;

	readonly openLabel?: { readonly withMnemonic: string; readonly withoutMnemonic: string } | string;

	canSelectFiles?: boolean;

	canSelectFolders?: boolean;

	readonly canSelectMany?: boolean;

	filters?: FileFilter[];

	availableFileSystems?: readonly string[];
}

export const IDialogService = createDecorator<IDialogService>('dialogService');

export interface ICustomDialogOptions {
	readonly buttonDetails?: string[];
	readonly markdownDetails?: ICustomDialogMarkdown[];
	readonly classes?: string[];
	readonly icon?: ThemeIcon;
	readonly disableCloseAction?: boolean;

	readonly alignment?: 'horizontal' | 'vertical';
}

export interface ICustomDialogMarkdown {
	readonly markdown: IMarkdownString;
	readonly classes?: string[];
	actionHandler?(link: string): Promise<boolean>;
}

export interface IDialogHandler {

	confirm(confirmation: IConfirmation): Promise<IConfirmationResult>;

	prompt<T>(prompt: IPrompt<T>): Promise<IAsyncPromptResult<T>>;

	input(input: IInput): Promise<IInputResult>;

	about(title: string, details: string, detailsToCopy: string): Promise<void>;
}

enum DialogKind {
	Confirmation = 1,
	Prompt,
	Input
}

export abstract class AbstractDialogHandler implements IDialogHandler {

	protected getConfirmationButtons(dialog: IConfirmation): string[] {
		return this.getButtons(dialog, DialogKind.Confirmation);
	}

	protected getPromptButtons(dialog: IPrompt<unknown>): string[] {
		return this.getButtons(dialog, DialogKind.Prompt);
	}

	protected getInputButtons(dialog: IInput): string[] {
		return this.getButtons(dialog, DialogKind.Input);
	}

	private getButtons(dialog: IConfirmation, kind: DialogKind.Confirmation): string[];
	private getButtons(dialog: IPrompt<unknown>, kind: DialogKind.Prompt): string[];
	private getButtons(dialog: IInput, kind: DialogKind.Input): string[];
	private getButtons(dialog: IConfirmation | IInput | IPrompt<unknown>, kind: DialogKind): string[] {


		const buttons: string[] = [];

		switch (kind) {
			case DialogKind.Confirmation: {
				const confirmationDialog = dialog as IConfirmation;

				if (confirmationDialog.primaryButton) {
					buttons.push(confirmationDialog.primaryButton);
				} else {
					buttons.push(localize({ key: 'yesButton', comment: ['&& denotes a mnemonic'] }, "&&Yes"));
				}

				if (confirmationDialog.cancelButton) {
					buttons.push(confirmationDialog.cancelButton);
				} else {
					buttons.push(localize('cancelButton', "Cancel"));
				}

				break;
			}
			case DialogKind.Prompt: {
				const promptDialog = dialog as IPrompt<unknown>;

				if (Array.isArray(promptDialog.buttons) && promptDialog.buttons.length > 0) {
					buttons.push(...promptDialog.buttons.map(button => button.label));
				}

				if (promptDialog.cancelButton) {
					if (promptDialog.cancelButton === true) {
						buttons.push(localize('cancelButton', "Cancel"));
					} else if (typeof promptDialog.cancelButton === 'string') {
						buttons.push(promptDialog.cancelButton);
					} else {
						if (promptDialog.cancelButton.label) {
							buttons.push(promptDialog.cancelButton.label);
						} else {
							buttons.push(localize('cancelButton', "Cancel"));
						}
					}
				}

				if (buttons.length === 0) {
					buttons.push(localize({ key: 'okButton', comment: ['&& denotes a mnemonic'] }, "&&OK"));
				}

				break;
			}
			case DialogKind.Input: {
				const inputDialog = dialog as IInput;

				if (inputDialog.primaryButton) {
					buttons.push(inputDialog.primaryButton);
				} else {
					buttons.push(localize({ key: 'okButton', comment: ['&& denotes a mnemonic'] }, "&&OK"));
				}

				if (inputDialog.cancelButton) {
					buttons.push(inputDialog.cancelButton);
				} else {
					buttons.push(localize('cancelButton', "Cancel"));
				}

				break;
			}
		}

		return buttons;
	}

	protected getDialogType(type: Severity | DialogType | undefined): DialogType | undefined {
		if (typeof type === 'string') {
			return type;
		}

		if (typeof type === 'number') {
			return (type === Severity.Info) ? 'info' : (type === Severity.Error) ? 'error' : (type === Severity.Warning) ? 'warning' : 'none';
		}

		return undefined;
	}

	protected getPromptResult<T>(prompt: IPrompt<T>, buttonIndex: number, checkboxChecked: boolean | undefined): IAsyncPromptResult<T> {
		const promptButtons: IPromptBaseButton<T>[] = [...(prompt.buttons ?? [])];
		if (prompt.cancelButton && typeof prompt.cancelButton !== 'string' && typeof prompt.cancelButton !== 'boolean') {
			promptButtons.push(prompt.cancelButton);
		}

		let result = promptButtons[buttonIndex]?.run({ checkboxChecked });
		if (!(result instanceof Promise)) {
			result = Promise.resolve(result);
		}

		return { result, checkboxChecked };
	}

	abstract confirm(confirmation: IConfirmation): Promise<IConfirmationResult>;
	abstract input(input: IInput): Promise<IInputResult>;
	abstract prompt<T>(prompt: IPrompt<T>): Promise<IAsyncPromptResult<T>>;
	abstract about(title: string, details: string, detailsToCopy: string): Promise<void>;
}

export interface IDialogService {

	readonly _serviceBrand: undefined;

	readonly onWillShowDialog: Event<void>;

	readonly onDidShowDialog: Event<void>;

	confirm(confirmation: IConfirmation): Promise<IConfirmationResult>;

	prompt<T>(prompt: IPromptWithCustomCancel<T>): Promise<IPromptResultWithCancel<T>>;
	prompt<T>(prompt: IPromptWithDefaultCancel<T>): Promise<IPromptResult<T>>;
	prompt<T>(prompt: IPrompt<T>): Promise<IPromptResult<T>>;

	input(input: IInput): Promise<IInputResult>;

	info(message: string, detail?: string): Promise<void>;

	warn(message: string, detail?: string): Promise<void>;

	error(message: string, detail?: string): Promise<void>;

	about(): Promise<void>;
}

export const IFileDialogService = createDecorator<IFileDialogService>('fileDialogService');

export interface IFileDialogService {

	readonly _serviceBrand: undefined;

	defaultFilePath(schemeFilter?: string): Promise<URI>;

	defaultFolderPath(schemeFilter?: string): Promise<URI>;

	defaultWorkspacePath(schemeFilter?: string): Promise<URI>;

	pickFileFolderAndOpen(options: IPickAndOpenOptions): Promise<void>;

	pickFileAndOpen(options: IPickAndOpenOptions): Promise<void>;

	pickFolderAndOpen(options: IPickAndOpenOptions): Promise<void>;

	pickWorkspaceAndOpen(options: IPickAndOpenOptions): Promise<void>;

	pickFileToSave(defaultUri: URI, availableFileSystems?: string[]): Promise<URI | undefined>;

	preferredHome(schemeFilter?: string): Promise<URI>;

	showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined>;

	showSaveConfirm(fileNamesOrResources: (string | URI)[]): Promise<ConfirmResult>;

	showOpenDialog(options: IOpenDialogOptions): Promise<URI[] | undefined>;
}

export const enum ConfirmResult {
	SAVE,
	DONT_SAVE,
	CANCEL
}

const MAX_CONFIRM_FILES = 10;
export function getFileNamesMessage(fileNamesOrResources: readonly (string | URI)[]): string {
	const message: string[] = [];
	message.push(...fileNamesOrResources.slice(0, MAX_CONFIRM_FILES).map(fileNameOrResource => typeof fileNameOrResource === 'string' ? fileNameOrResource : basename(fileNameOrResource)));

	if (fileNamesOrResources.length > MAX_CONFIRM_FILES) {
		if (fileNamesOrResources.length - MAX_CONFIRM_FILES === 1) {
			message.push(localize('moreFile', "...1 additional file not shown"));
		} else {
			message.push(localize('moreFiles', "...{0} additional files not shown", fileNamesOrResources.length - MAX_CONFIRM_FILES));
		}
	}

	message.push('');
	return message.join('\n');
}

export interface INativeOpenDialogOptions {
	readonly forceNewWindow?: boolean;

	readonly defaultPath?: string;

	readonly telemetryEventName?: string;
	readonly telemetryExtraData?: ITelemetryData;
}
