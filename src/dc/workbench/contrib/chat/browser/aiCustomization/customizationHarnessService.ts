/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import {
	CustomizationHarnessServiceBase,
	ICustomizationHarnessService,
	createVSCodeHarnessDescriptor,

} from '../../common/customizationHarnessService.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';
import { SessionType } from '../../common/chatSessionsService.js';
import { URI } from '../../../../../base/common/uri.js';

class CustomizationHarnessService extends CustomizationHarnessServiceBase {
	constructor(
		@IPromptsService promptsService: IPromptsService,
	) {
		super(
			[createVSCodeHarnessDescriptor()],
			SessionType.Local,
			promptsService,
		);
	}

	override getSessionResourceForHarness(sessionType: string): URI {


		return super.getSessionResourceForHarness(sessionType);
	}
}

registerSingleton(ICustomizationHarnessService, CustomizationHarnessService, InstantiationType.Delayed);

