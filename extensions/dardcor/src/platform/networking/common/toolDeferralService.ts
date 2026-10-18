/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';

export const IToolDeferralService = createServiceIdentifier<IToolDeferralService>('IToolDeferralService');

export interface IToolDeferralService {
	readonly _serviceBrand: undefined;

	isNonDeferredTool(name: string): boolean;
}
