/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel, ITextBufferFactory, ITextSnapshot, ModelConstants } from '../../../editor/common/model.js';
import { EditorModel } from './editorModel.js';
import { ILanguageSupport } from '../../services/textfile/common/textfiles.js';
import { URI } from '../../../base/common/uri.js';
import { ITextEditorModel, IResolvedTextEditorModel } from '../../../editor/common/services/resolverService.js';
import { ILanguageService, ILanguageSelection } from '../../../editor/common/languages/language.js';
import { IModelService } from '../../../editor/common/services/model.js';
import { MutableDisposable } from '../../../base/common/lifecycle.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../editor/common/languages/modesRegistry.js';
import { ILanguageDetectionService, LanguageDetectionLanguageEventSource } from '../../services/languageDetection/common/languageDetectionWorkerService.js';
import { ThrottledDelayer } from '../../../base/common/async.js';
import { IAccessibilityService } from '../../../platform/accessibility/common/accessibility.js';
import { localize } from '../../../nls.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { TextModelEditSource } from '../../../editor/common/textModelEditSource.js';

export class BaseTextEditorModel extends EditorModel implements ITextEditorModel, ILanguageSupport {

	private static readonly AUTO_DETECT_LANGUAGE_THROTTLE_DELAY = 600;

	protected textEditorModelHandle: URI | undefined = undefined;

	private createdEditorModel: boolean | undefined;

	private readonly modelDisposeListener = this._register(new MutableDisposable());
	private readonly autoDetectLanguageThrottler = this._register(new ThrottledDelayer<void>(BaseTextEditorModel.AUTO_DETECT_LANGUAGE_THROTTLE_DELAY));

	constructor(
		@IModelService protected modelService: IModelService,
		@ILanguageService protected languageService: ILanguageService,
		@ILanguageDetectionService private readonly languageDetectionService: ILanguageDetectionService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		textEditorModelHandle?: URI
	) {
		super();

		if (textEditorModelHandle) {
			this.handleExistingModel(textEditorModelHandle);
		}
	}

	private handleExistingModel(textEditorModelHandle: URI): void {

		const model = this.modelService.getModel(textEditorModelHandle);
		if (!model) {
			throw new Error(`Document with resource ${textEditorModelHandle.toString(true)} does not exist`);
		}

		this.textEditorModelHandle = textEditorModelHandle;

		this.registerModelDisposeListener(model);
	}

	private registerModelDisposeListener(model: ITextModel): void {
		this.modelDisposeListener.value = model.onWillDispose(() => {
			this.textEditorModelHandle = undefined;
			this.dispose();
		});
	}

	get textEditorModel(): ITextModel | null {
		return this.textEditorModelHandle ? this.modelService.getModel(this.textEditorModelHandle) : null;
	}

	isReadonly(): boolean | IMarkdownString {
		return true;
	}

	private _blockLanguageChangeListener = false;
	private _languageChangeSource: 'user' | 'api' | undefined = undefined;
	get languageChangeSource() { return this._languageChangeSource; }
	get hasLanguageSetExplicitly() {
		return typeof this._languageChangeSource === 'string';
	}

	setLanguageId(languageId: string, source?: string): void {

		this._languageChangeSource = 'user';

		this.setLanguageIdInternal(languageId, source);
	}

	private setLanguageIdInternal(languageId: string, source?: string): void {
		if (!this.isResolved()) {
			return;
		}

		if (!languageId || languageId === this.textEditorModel.getLanguageId()) {
			return;
		}

		this._blockLanguageChangeListener = true;
		try {
			this.textEditorModel.setLanguage(this.languageService.createById(languageId), source);
		} finally {
			this._blockLanguageChangeListener = false;
		}
	}

	protected installModelListeners(model: ITextModel): void {

		const disposable = this._register(model.onDidChangeLanguage(e => {
			if (
				e.source === LanguageDetectionLanguageEventSource ||
				this._blockLanguageChangeListener
			) {
				return;
			}

			this._languageChangeSource = 'api';
			disposable.dispose();
		}));
	}

	getLanguageId(): string | undefined {
		return this.textEditorModel?.getLanguageId();
	}

	protected autoDetectLanguage(): Promise<void> {
		return this.autoDetectLanguageThrottler.trigger(() => this.doAutoDetectLanguage());
	}

	private async doAutoDetectLanguage(): Promise<void> {
		if (
			this.hasLanguageSetExplicitly ||
			!this.textEditorModelHandle ||
			!this.languageDetectionService.isEnabledForLanguage(this.getLanguageId() ?? PLAINTEXT_LANGUAGE_ID)
		) {
			return;
		}

		const lang = await this.languageDetectionService.detectLanguage(this.textEditorModelHandle);
		const prevLang = this.getLanguageId();
		if (lang && lang !== prevLang && !this.isDisposed()) {
			this.setLanguageIdInternal(lang, LanguageDetectionLanguageEventSource);
			const languageName = this.languageService.getLanguageName(lang);
			this.accessibilityService.alert(localize('languageAutoDetected', "Language {0} was automatically detected and set as the language mode.", languageName ?? lang));
		}
	}

	protected createTextEditorModel(value: ITextBufferFactory, resource: URI | undefined, preferredLanguageId?: string): ITextModel {
		const firstLineText = this.getFirstLineText(value);
		const languageSelection = this.getOrCreateLanguage(resource, this.languageService, preferredLanguageId, firstLineText);

		return this.doCreateTextEditorModel(value, languageSelection, resource);
	}

	private doCreateTextEditorModel(value: ITextBufferFactory, languageSelection: ILanguageSelection, resource: URI | undefined): ITextModel {
		let model = resource && this.modelService.getModel(resource);
		if (!model) {
			model = this.modelService.createModel(value, languageSelection, resource);
			this.createdEditorModel = true;

			this.registerModelDisposeListener(model);
		} else {
			this.updateTextEditorModel(value, languageSelection.languageId);
		}

		this.textEditorModelHandle = model.uri;

		return model;
	}

	protected getFirstLineText(value: ITextBufferFactory | ITextModel): string {

		const textBufferFactory = value as ITextBufferFactory;
		if (typeof textBufferFactory.getFirstLineText === 'function') {
			return textBufferFactory.getFirstLineText(ModelConstants.FIRST_LINE_DETECTION_LENGTH_LIMIT);
		}

		const textSnapshot = value as ITextModel;
		return textSnapshot.getLineContent(1).substr(0, ModelConstants.FIRST_LINE_DETECTION_LENGTH_LIMIT);
	}

	protected getOrCreateLanguage(resource: URI | undefined, languageService: ILanguageService, preferredLanguage: string | undefined, firstLineText?: string): ILanguageSelection {

		if (!preferredLanguage || preferredLanguage === PLAINTEXT_LANGUAGE_ID) {
			return languageService.createByFilepathOrFirstLine(resource ?? null, firstLineText);
		}

		return languageService.createById(preferredLanguage);
	}

	updateTextEditorModel(newValue?: ITextBufferFactory, preferredLanguageId?: string, reason?: TextModelEditSource): void {
		if (!this.isResolved()) {
			return;
		}

		if (newValue) {
			this.modelService.updateModel(this.textEditorModel, newValue, reason);
		}

		if (preferredLanguageId && preferredLanguageId !== PLAINTEXT_LANGUAGE_ID && this.textEditorModel.getLanguageId() !== preferredLanguageId) {
			this.textEditorModel.setLanguage(this.languageService.createById(preferredLanguageId));
		}
	}

	createSnapshot(this: IResolvedTextEditorModel): ITextSnapshot;
	createSnapshot(this: ITextEditorModel): ITextSnapshot | null;
	createSnapshot(): ITextSnapshot | null {
		if (!this.textEditorModel) {
			return null;
		}

		return this.textEditorModel.createSnapshot(true );
	}

	override isResolved(): this is IResolvedTextEditorModel {
		return !!this.textEditorModelHandle;
	}

	override dispose(): void {
		this.modelDisposeListener.dispose();

		if (this.textEditorModelHandle && this.createdEditorModel) {
			this.modelService.destroyModel(this.textEditorModelHandle);
		}

		this.textEditorModelHandle = undefined;
		this.createdEditorModel = false;

		super.dispose();
	}
}
