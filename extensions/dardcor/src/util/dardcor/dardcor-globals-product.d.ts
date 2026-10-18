
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare global {

	var _VSCODE_FILE_ROOT: string;

	var _VSCODE_CSS_LOAD: (module: string) => void;

	var _VSCODE_PRODUCT_JSON: Record<string, any>;
	var _VSCODE_PACKAGE_JSON: Record<string, any>;

	var _VSCODE_DISABLE_CSS_IMPORT_MAP: boolean | undefined;

	var _VSCODE_USE_RELATIVE_IMPORTS: boolean | undefined;
}

// fake export to make global work
export { }
