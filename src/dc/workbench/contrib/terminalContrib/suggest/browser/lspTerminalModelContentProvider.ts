/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { Schemas } from '../../../../../base/common/network.js';
import { ICommandDetectionCapability, ITerminalCapabilityStore, TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalShellType } from '../../../../../platform/terminal/common/terminal.js';
import { VSCODE_LSP_TERMINAL_PROMPT_TRACKER } from './lspTerminalUtil.js';

export interface ILspTerminalModelContentProvider extends ITextModelContentProvider {
	setContent(content: string): void;
	dispose(): void;
}

export class LspTerminalModelContentProvider extends Disposable implements ILspTerminalModelContentProvider, ITextModelContentProvider {
	static readonly scheme = Schemas.vscodeTerminal;
	private _commandDetection: ICommandDetectionCapability | undefined;
	private _capabilitiesStore: ITerminalCapabilityStore;
	private readonly _virtualTerminalDocumentUri: URI;
	private _shellType: TerminalShellType | undefined;
	private readonly _onCommandFinishedListener = this._register(new MutableDisposable());

	constructor(
		capabilityStore: ITerminalCapabilityStore,
		terminalId: number,
		virtualTerminalDocument: URI,
		shellType: TerminalShellType | undefined,
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,

	) {
		super();
		this._register(textModelService.registerTextModelContentProvider(LspTerminalModelContentProvider.scheme, this));
		this._capabilitiesStore = capabilityStore;
		this._commandDetection = this._capabilitiesStore.get(TerminalCapability.CommandDetection);
		this._registerTerminalCommandFinishedListener();
		this._virtualTerminalDocumentUri = virtualTerminalDocument;
		this._shellType = shellType;
	}

	shellTypeChanged(shellType: TerminalShellType | undefined): void {
		this._shellType = shellType;
	}

	setContent(content: string): void {
		const model = this._modelService.getModel(this._virtualTerminalDocumentUri);
		if (this._shellType) {
			if (model) {
				const existingContent = model.getValue();
				if (existingContent === '') {
					model.setValue(VSCODE_LSP_TERMINAL_PROMPT_TRACKER);
				} else {
					const delimiterIndex = existingContent.lastIndexOf(VSCODE_LSP_TERMINAL_PROMPT_TRACKER);
					const sanitizedExistingContent = delimiterIndex !== -1 ?
						existingContent.substring(0, delimiterIndex) :
						existingContent;

					const newContent = sanitizedExistingContent + '\n' + content + '\n' + VSCODE_LSP_TERMINAL_PROMPT_TRACKER;
					model.setValue(newContent);
				}
			}
		}
	}

	trackPromptInputToVirtualFile(content: string): void {
		this._commandDetection = this._capabilitiesStore.get(TerminalCapability.CommandDetection);
		const model = this._modelService.getModel(this._virtualTerminalDocumentUri);
		if (this._shellType) {
			if (model) {
				const existingContent = model.getValue();
				const delimiterIndex = existingContent.lastIndexOf(VSCODE_LSP_TERMINAL_PROMPT_TRACKER);

				const sanitizedExistingContent = delimiterIndex !== -1 ?
					existingContent.substring(0, delimiterIndex) :
					existingContent;

				const newContent = sanitizedExistingContent + VSCODE_LSP_TERMINAL_PROMPT_TRACKER + content;

				model.setValue(newContent);
			}
		}
	}

	private _registerTerminalCommandFinishedListener(): void {
		const attachListener = () => {
			if (this._onCommandFinishedListener.value) {
				return;
			}

			if (this._commandDetection && this._commandDetection.onCommandFinished) {
				this._onCommandFinishedListener.value = this._register(this._commandDetection.onCommandFinished((e) => {
					if (e.exitCode === 0 && this._shellType) {
						this.setContent(e.command);
					}

				}));
			}
		};
		attachListener();

		this._register(this._capabilitiesStore.onDidAddCommandDetectionCapability(e => {
			this._commandDetection = e;
			attachListener();
		}));
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this._modelService.getModel(resource);

		if (existing && !existing.isDisposed()) {
			return existing;
		}

		const languageId = this._languageService.guessLanguageIdByFilepathOrFirstLine(resource);

		const languageSelection = languageId ?
			this._languageService.createById(languageId) :
			this._languageService.createById('plaintext');

		return this._modelService.createModel('', languageSelection, resource, false);
	}

}

export function createTerminalLanguageVirtualUri(terminalId: number, languageExtension: string): URI {
	return URI.from({
		scheme: Schemas.vscodeTerminal,
		path: `/terminal${terminalId}.${languageExtension}`,
	});
}
