/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function backwardCompatSetting<TOld, TNew>(settingValue: TNew, map: (oldValue: TOld | TNew) => TNew): TNew {
	return map(settingValue);
}
