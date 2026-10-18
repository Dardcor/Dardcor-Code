
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare global {
	/**
	 * All NLS messages produced by `localize` and `localize2` calls
	 * under `src/vs` translated to the language as indicated by
	 * `_VSCODE_NLS_LANGUAGE`.
	 *
	 * Instead of accessing this global variable directly, use function getNLSMessages.
	 */
	var _VSCODE_NLS_MESSAGES: string[];
	/**
	 * The actual language of the NLS messages (e.g. 'en', de' or 'pt-br').
	 *
	 * Instead of accessing this global variable directly, use function getNLSLanguage.
	 */
	var _VSCODE_NLS_LANGUAGE: string | undefined;
}

// fake export to make global work
export { }
