/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const sortAutoApproveRules: Readonly<Record<string, boolean>> = {
	'/^sort\\b(?!-)/': true,

	'/^sort\\b.*\\s-(o|S)\\b/': false,

	'/^sort\\b.*\\s(?:\\$?[\'"]|\\\\)*-(?:\\$?[\'"]|\\\\)*-(?:\\$?[\'"]|\\\\)*c(?:\\$?[\'"]|\\\\)*o/': false,
};
