/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum WASMLanguage {
	Python = 'python',
	JavaScript = 'javascript',
	TypeScript = 'typescript',
	TypeScriptTsx = 'tsx',
	Go = 'go',
	Ruby = 'ruby',
	Csharp = 'csharp',
	Cpp = 'cpp',
	Java = 'java',
	Rust = 'rust',
}

export class TreeSitterUnknownLanguageError extends Error {
	constructor(language: string) {
		super(`Unrecognized language: ${language}`);
	}
}

const languageIdToWasmLanguageMapping: { [language: string]: WASMLanguage } = {
	python: WASMLanguage.Python,
	javascript: WASMLanguage.JavaScript,
	javascriptreact: WASMLanguage.JavaScript,
	jsx: WASMLanguage.JavaScript,
	typescript: WASMLanguage.TypeScript,
	typescriptreact: WASMLanguage.TypeScriptTsx,
	tsx: WASMLanguage.TypeScriptTsx,
	go: WASMLanguage.Go,
	ruby: WASMLanguage.Ruby,
	csharp: WASMLanguage.Csharp,
	cpp: WASMLanguage.Cpp,
	java: WASMLanguage.Java,
	rust: WASMLanguage.Rust,
};

export function getWasmLanguage(languageId: string): WASMLanguage | undefined {
	if (languageId in languageIdToWasmLanguageMapping) {
		return languageIdToWasmLanguageMapping[languageId];
	}
}
