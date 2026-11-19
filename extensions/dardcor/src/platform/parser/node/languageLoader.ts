/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../util/dardcor/base/common/path';
import { WASMLanguage } from './treeSitterLanguages';
import Parser = require('web-tree-sitter');

export class LanguageLoader {

	private readonly loadedLanguagesCache;

	constructor() {
		this.loadedLanguagesCache = new Map<WASMLanguage, Promise<Parser.Language>>();
	}

	loadLanguage(wasmLanguage: WASMLanguage): Promise<Parser.Language> {
		if (!this.loadedLanguagesCache.has(wasmLanguage)) {
			this.loadedLanguagesCache.set(wasmLanguage, this._doLoadLanguage(wasmLanguage));
		}
		return this.loadedLanguagesCache.get(wasmLanguage)!;
	}

	private _doLoadLanguage(language: WASMLanguage): Promise<Parser.Language> {
		const wasmFileLang = language === 'csharp' ? 'c-sharp' : language;

		const wasmFilename = `tree-sitter-${wasmFileLang}.wasm`;

		const wasmFile =
			path.basename(__dirname) === 'dist'
				? path.resolve(__dirname, wasmFilename)
				: path.resolve(__dirname, '../../../../dist', wasmFilename);

		return Parser.Language.load(wasmFile);
	}
}
