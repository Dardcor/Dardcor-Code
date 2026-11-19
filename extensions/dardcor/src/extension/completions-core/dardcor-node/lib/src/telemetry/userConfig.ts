/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../../../../util/common/services';

interface UserConfigProperties {
	dardcor_trackingId: string;
	organizations_list?: string;
	enterprise_list?: string;
	sku?: string;
}

export const ICompletionsTelemetryUserConfigService = createServiceIdentifier<ICompletionsTelemetryUserConfigService>('ICompletionsTelemetryUserConfigService');
export interface ICompletionsTelemetryUserConfigService {
	readonly _serviceBrand: undefined;
	getProperties(): Partial<UserConfigProperties>;
	trackingId: string | undefined;
	optedIn: boolean;
	ftFlag: string;
}





export class TelemetryUserConfig implements ICompletionsTelemetryUserConfigService {
	declare _serviceBrand: undefined;
	optedIn = false;
	ftFlag = '';
	trackingId: string | undefined;

	getProperties(): Partial<UserConfigProperties> {
		return {};
	}
}
