/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {



	export class FileDecoration2 {
		badge?: string | ThemeIcon;

		tooltip?: string;

		color?: ThemeColor;

		propagate?: boolean;

		constructor(badge?: string | ThemeIcon, tooltip?: string, color?: ThemeColor);
	}
}
