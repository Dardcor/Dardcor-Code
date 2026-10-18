/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Handler } from '../../../../editor/common/editorCommon.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

const terminalCommandPasteDontAskAgainStorageKey = 'chat.terminalCommandPaste.dontAskAgain';

export function isTerminalCommandInput(value: string, prefix: string | undefined): boolean {
	return !!prefix && value.startsWith(prefix);
}

interface ITerminalCommandPaste {
	readonly prefix: string;
	readonly pastedText: string;
	readonly currentValue: string;
	readonly selectionStartOffset: number;
	readonly selectionEndOffset: number;
}

export function isTerminalCommandPaste(paste: ITerminalCommandPaste): boolean {
	const selectionStartOffset = Math.max(0, Math.min(paste.selectionStartOffset, paste.currentValue.length));
	const selectionEndOffset = Math.max(selectionStartOffset, Math.min(paste.selectionEndOffset, paste.currentValue.length));

	if (paste.currentValue.length !== 0 && selectionStartOffset !== 0) {
		return false;
	}

	const resultingText = paste.currentValue.slice(0, selectionStartOffset) + paste.pastedText + paste.currentValue.slice(selectionEndOffset);

	return resultingText.startsWith(paste.prefix);
}

function isTerminalCommandPasteWarningSuppressed(storageService: IStorageService): boolean {
	return storageService.getBoolean(terminalCommandPasteDontAskAgainStorageKey, StorageScope.APPLICATION, false);
}

/** Prompts for terminal command paste confirmation and persists the global suppression choice. */
async function shouldPasteTerminalCommand(
	dialogService: IDialogService,
	storageService: IStorageService,
	prefix: string,
): Promise<'paste' | 'cancel'> {
	if (isTerminalCommandPasteWarningSuppressed(storageService)) {
		return 'paste';
	}

	const { result } = await dialogService.prompt<'paste' | 'pasteAndDontAskAgain'>({
		type: 'warning',
		message: localize('terminalCommandPasteWarning', "The pasted text starts with \"{0}\", which will run the message as a terminal command when sent. Paste anyway?", prefix),
		buttons: [
			{
				label: localize('paste', "Paste"),
				run: () => 'paste',
			},
			{
				label: localize('pasteAndDontAskAgain', "Paste and Don't Ask Again"),
				run: () => 'pasteAndDontAskAgain',
			},
		],
		custom: true,
		cancelButton: true,
	});

	if (result === 'pasteAndDontAskAgain') {
		storageService.store(terminalCommandPasteDontAskAgainStorageKey, true, StorageScope.APPLICATION, StorageTarget.USER);
		return 'paste';
	}

	return result === 'paste' ? 'paste' : 'cancel';
}

export function handleTerminalCommandPaste(
	e: ClipboardEvent,
	editor: ICodeEditor,
	prefix: string | undefined,
	dialogService: IDialogService,
	storageService: IStorageService,
): void {
	if (e.defaultPrevented || !prefix) {
		return;
	}

	const pastedText = e.clipboardData?.getData('text');
	const model = editor.getModel();
	const selection = editor.getSelection();
	if (!pastedText || !model || !selection) {
		return;
	}

	const paste: ITerminalCommandPaste = {
		prefix,
		pastedText,
		currentValue: model.getValue(),
		selectionStartOffset: model.getOffsetAt(selection.getStartPosition()),
		selectionEndOffset: model.getOffsetAt(selection.getEndPosition()),
	};
	if (!isTerminalCommandPaste(paste) || isTerminalCommandPasteWarningSuppressed(storageService)) {
		return;
	}

	e.preventDefault();
	e.stopImmediatePropagation();

	shouldPasteTerminalCommand(dialogService, storageService, prefix).then(result => {
		if (result === 'paste') {
			editor.trigger('keyboard', Handler.Paste, { text: pastedText });
		}
	});
}
