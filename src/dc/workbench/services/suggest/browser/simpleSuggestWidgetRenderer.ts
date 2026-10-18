/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, show } from '../../../../base/browser/dom.js';
import { IconLabel, IIconLabelValueOptions } from '../../../../base/browser/ui/iconLabel/iconLabel.js';
import { IListRenderer } from '../../../../base/browser/ui/list/list.js';
import { SimpleCompletionItem } from './simpleCompletionItem.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createMatches } from '../../../../base/common/filters.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { URI } from '../../../../base/common/uri.js';
import { FileKind } from '../../../../platform/files/common/files.js';

export function getAriaId(index: number): string {
	return `simple-suggest-aria-id-${index}`;
}

export interface ISimpleSuggestionTemplateData {
	readonly root: HTMLElement;

	readonly left: HTMLElement;
	readonly right: HTMLElement;

	readonly icon: HTMLElement;
	readonly colorspan: HTMLElement;
	readonly iconLabel: IconLabel;
	readonly iconContainer: HTMLElement;
	readonly parametersLabel: HTMLElement;
	readonly qualifierLabel: HTMLElement;
	readonly detailsLabel: HTMLElement;
	readonly disposables: DisposableStore;
}

export interface ISimpleSuggestWidgetFontInfo {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	fontWeight: string;
	letterSpacing: number;
}

export class SimpleSuggestWidgetItemRenderer implements IListRenderer<SimpleCompletionItem, ISimpleSuggestionTemplateData> {

	private readonly _onDidToggleDetails = new Emitter<void>();
	readonly onDidToggleDetails: Event<void> = this._onDidToggleDetails.event;

	private readonly _disposables = new DisposableStore();

	readonly templateId = 'suggestion';

	constructor(
		private readonly _getFontInfo: () => ISimpleSuggestWidgetFontInfo,
		private readonly _onDidFontConfigurationChange: Event<void>,
		@IThemeService private readonly _themeService: IThemeService,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService) { }

	dispose(): void {
		this._onDidToggleDetails.dispose();
		this._disposables.dispose();
	}

	renderTemplate(container: HTMLElement): ISimpleSuggestionTemplateData {
		const disposables = new DisposableStore();

		const root = container;
		root.classList.add('show-file-icons');

		const icon = append(container, $('.icon'));
		const colorspan = append(icon, $('span.colorspan'));

		const text = append(container, $('.contents'));
		const main = append(text, $('.main'));

		const iconContainer = append(main, $('.icon-label.codicon'));
		const left = append(main, $('span.left'));
		const right = append(main, $('span.right'));

		const iconLabel = new IconLabel(left, { supportHighlights: true, supportIcons: true });
		disposables.add(iconLabel);

		const parametersLabel = append(left, $('span.signature-label'));
		const qualifierLabel = append(left, $('span.qualifier-label'));
		const detailsLabel = append(right, $('span.details-label'));


		const configureFont = () => {
			const fontFeatureSettings = '';
			const { fontFamily, fontSize, lineHeight, fontWeight, letterSpacing } = this._getFontInfo();
			const fontSizePx = `${fontSize}px`;
			const lineHeightPx = `${lineHeight}px`;
			const letterSpacingPx = `${letterSpacing}px`;

			root.style.fontSize = fontSizePx;
			root.style.fontWeight = fontWeight;
			root.style.letterSpacing = letterSpacingPx;
			main.style.fontFamily = fontFamily;
			main.style.fontFeatureSettings = fontFeatureSettings;
			main.style.lineHeight = lineHeightPx;
			icon.style.height = lineHeightPx;
			icon.style.width = lineHeightPx;
		};

		configureFont();
		this._disposables.add(this._onDidFontConfigurationChange(() => configureFont()));
		return { root, left, right, icon, colorspan, iconLabel, iconContainer, parametersLabel, qualifierLabel, detailsLabel, disposables };
	}

	renderElement(element: SimpleCompletionItem, index: number, data: ISimpleSuggestionTemplateData): void {
		const { completion } = element;
		data.root.id = getAriaId(index);
		data.colorspan.style.backgroundColor = '';

		const labelOptions: IIconLabelValueOptions = {
			labelEscapeNewLines: true,
			matches: createMatches(element.score)
		};


		if (completion.kindLabel === 'File' && this._themeService.getFileIconTheme().hasFileIcons) {
			data.icon.className = 'icon hide';
			data.iconContainer.className = 'icon hide';
			const labelClasses = getIconClasses(this._modelService, this._languageService, URI.from({ scheme: 'fake', path: element.textLabel }), FileKind.FILE);
			const detailClasses = getIconClasses(this._modelService, this._languageService, URI.from({ scheme: 'fake', path: completion.detail }), FileKind.FILE);
			labelOptions.extraClasses = labelClasses.length > detailClasses.length ? labelClasses : detailClasses;

		} else if (completion.kindLabel === 'Folder' && this._themeService.getFileIconTheme().hasFolderIcons) {
			data.icon.className = 'icon hide';
			data.iconContainer.className = 'icon hide';
			labelOptions.extraClasses = [
				getIconClasses(this._modelService, this._languageService, URI.from({ scheme: 'fake', path: element.textLabel }), FileKind.FOLDER),
				getIconClasses(this._modelService, this._languageService, URI.from({ scheme: 'fake', path: completion.detail }), FileKind.FOLDER)
			].flat();
		} else {
			data.icon.className = 'icon hide';
			data.iconContainer.className = '';
			data.iconContainer.classList.add('suggest-icon', ...ThemeIcon.asClassNameArray(completion.icon || Codicon.symbolText));
		}


		data.iconLabel.setLabel(element.textLabel, undefined, labelOptions);
		if (typeof completion.label === 'string') {
			data.parametersLabel.textContent = '';
			data.detailsLabel.textContent = stripNewLines(completion.detail || '');
			data.root.classList.add('string-label');
		} else {
			const labelDetail = stripNewLines(completion.label.detail || '');
			data.parametersLabel.textContent = normalizeLabelDetail(labelDetail);
			data.detailsLabel.textContent = stripNewLines(completion.label.description || '');
			data.root.classList.remove('string-label');
		}

		show(data.detailsLabel);

		data.right.classList.remove('can-expand-details');
	}

	disposeTemplate(templateData: ISimpleSuggestionTemplateData): void {
		templateData.disposables.dispose();
	}
}

function stripNewLines(str: string): string {
	return str.replace(/\r\n|\r|\n/g, '');
}

const LEADING_PUNCTUATION_OR_SPACE = /^[\s()[\]{}<>"'`~!@#$%^&*+=,.:;?/\\|-]/;

function normalizeLabelDetail(detail: string): string {
	if (!detail) {
		return '';
	}
	return LEADING_PUNCTUATION_OR_SPACE.test(detail) ? detail : ` ${detail}`;
}
