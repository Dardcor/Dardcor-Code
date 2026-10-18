/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ChatConfiguration } from '../common/constants.js';
import { DARD_COR_VENDOR_ID, ILanguageModelsService } from '../common/languageModels.js';
import { createDefaultModelArrays, DefaultModelContribution } from './defaultModelContribution.js';

const defaultEntryLabel = localize('chat.utilityModel.defaultEntry.label', 'Default');
const defaultEntryDescription = localize('chat.utilityModel.defaultEntry.description', "Use the default behavior for utility models");

const utilityArrays = createDefaultModelArrays(defaultEntryLabel, defaultEntryDescription);
const utilitySmallArrays = createDefaultModelArrays(defaultEntryLabel, defaultEntryDescription);

export class UtilityModelContribution extends DefaultModelContribution {
	static readonly ID = 'workbench.contrib.utilityModel';

	static readonly modelIds = utilityArrays.modelIds;
	static readonly modelLabels = utilityArrays.modelLabels;
	static readonly modelDescriptions = utilityArrays.modelDescriptions;

	constructor(
		@ILanguageModelsService languageModelsService: ILanguageModelsService,
		@ILogService logService: ILogService,
	) {
		super(utilityArrays, {
			configKey: ChatConfiguration.UtilityModel,
			configSectionId: 'chatSidebar',
			logPrefix: '[UtilityModel]',
			filter: metadata => metadata.vendor !== DARD_COR_VENDOR_ID,
			storageFormat: 'vendorAndId',
			defaultEntryLabel,
			defaultEntryDescription,
		}, languageModelsService, logService);
	}
}

export class UtilitySmallModelContribution extends DefaultModelContribution {
	static readonly ID = 'workbench.contrib.utilitySmallModel';

	static readonly modelIds = utilitySmallArrays.modelIds;
	static readonly modelLabels = utilitySmallArrays.modelLabels;
	static readonly modelDescriptions = utilitySmallArrays.modelDescriptions;

	constructor(
		@ILanguageModelsService languageModelsService: ILanguageModelsService,
		@ILogService logService: ILogService,
	) {
		super(utilitySmallArrays, {
			configKey: ChatConfiguration.UtilitySmallModel,
			configSectionId: 'chatSidebar',
			logPrefix: '[UtilitySmallModel]',
			filter: metadata => metadata.vendor !== DARD_COR_VENDOR_ID,
			storageFormat: 'vendorAndId',
			defaultEntryLabel,
			defaultEntryDescription,
		}, languageModelsService, logService);
	}
}

registerWorkbenchContribution2(UtilityModelContribution.ID, UtilityModelContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(UtilitySmallModelContribution.ID, UtilitySmallModelContribution, WorkbenchPhase.AfterRestored);
