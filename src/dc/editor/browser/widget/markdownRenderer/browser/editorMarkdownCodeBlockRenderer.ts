/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../../../base/browser/dom.js';
import { createTrustedTypesPolicy } from '../../../../../base/browser/trustedTypes.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IMarkdownCodeBlockRenderer, IMarkdownRendererExtraOptions } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { EditorOption, IEditorOptions } from '../../../../common/config/editorOptions.js';
import { BareFontInfo } from '../../../../common/config/fontInfo.js';
import { createBareFontInfoFromRawSettings } from '../../../../common/config/fontInfoFromSettings.js';
import { ILanguageService } from '../../../../common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../common/languages/modesRegistry.js';
import { tokenizeToString } from '../../../../common/languages/textToHtmlTokenizer.js';
import { applyFontInfo } from '../../../config/domFontInfo.js';
import { ICodeEditor, isCodeEditor } from '../../../editorBrowser.js';
import './renderedMarkdown.css';

export class EditorMarkdownCodeBlockRenderer implements IMarkdownCodeBlockRenderer {

	private static _ttpTokenizer = createTrustedTypesPolicy('tokenizeToString', {
		createHTML(html: string) {
			return html;
		}
	});

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
	) { }

	public async renderCodeBlock(languageAlias: string | undefined, value: string, options: IMarkdownRendererExtraOptions): Promise<HTMLElement> {
		const editor = isCodeEditor(options.context) ? options.context : undefined;

		let languageId: string | undefined | null;
		if (languageAlias) {
			languageId = this._languageService.getLanguageIdByLanguageName(languageAlias);
		} else if (editor) {
			languageId = editor.getModel()?.getLanguageId();
		}
		if (!languageId) {
			languageId = PLAINTEXT_LANGUAGE_ID;
		}
		const html = await tokenizeToString(this._languageService, value, languageId);

		const content = EditorMarkdownCodeBlockRenderer._ttpTokenizer ? EditorMarkdownCodeBlockRenderer._ttpTokenizer.createHTML(html) ?? html : html;

		const root = document.createElement('span');
		root.innerHTML = content as string;
		// eslint-disable-next-line no-restricted-syntax
		const codeElement = root.querySelector('.monaco-tokenized-source');
		if (!isHTMLElement(codeElement)) {
			return document.createElement('span');
		}

		applyFontInfo(codeElement, this.getFontInfo(editor));

		return root;
	}

	private getFontInfo(editor: ICodeEditor | undefined): BareFontInfo {
		if (editor) {
			return editor.getOption(EditorOption.fontInfo);
		} else {
			// Otherwise use the global font settings.
			return createBareFontInfoFromRawSettings({
				fontFamily: this._configurationService.getValue<IEditorOptions>('editor').fontFamily
			}, 1);
		}
	}
}
