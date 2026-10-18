/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function shouldRequireConfirmationForAutoApproveParse(language: 'bash' | 'powershell', hasError: boolean): boolean {
	return language === 'powershell' && hasError;
}
