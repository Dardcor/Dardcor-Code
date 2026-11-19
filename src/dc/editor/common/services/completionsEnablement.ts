/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from '../../../platform/product/common/product.js';
import { isObject } from '../../../base/common/types.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ITextResourceConfigurationService } from './textResourceConfiguration.js';
import { URI } from '../../../base/common/uri.js';

function getCompletionsEnablementSettingName(): string | undefined {
	return product.defaultChatAgent?.completionsEnablementSetting;
}









export function isCompletionsEnabled(configurationService: IConfigurationService, modeId: string = '*'): boolean {
	const settingName = getCompletionsEnablementSettingName();
	if (!settingName) {
		return false;
	}

	return isCompletionsEnabledFromObject(
		configurationService.getValue<Record<string, boolean>>(settingName),
		modeId
	);
}









export function isCompletionsEnabledWithTextResourceConfig(configurationService: ITextResourceConfigurationService, resource: URI, modeId: string = '*'): boolean {
	const settingName = getCompletionsEnablementSettingName();
	if (!settingName) {
		return false;
	}


	return isCompletionsEnabledFromObject(
		configurationService.getValue<Record<string, boolean>>(resource, settingName),
		modeId
	);
}









export function isCompletionsEnabledFromObject(completionsEnablementObject: Record<string, boolean> | undefined, modeId: string = '*'): boolean {
	if (!isObject(completionsEnablementObject)) {
		return false;
	}

	if (typeof completionsEnablementObject[modeId] !== 'undefined') {
		return Boolean(completionsEnablementObject[modeId]);
	}

	return Boolean(completionsEnablementObject['*']);
}
