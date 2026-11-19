/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/dardcor/base/common/event';

export interface IDomainChangeEvent {
	capiUrlChanged: boolean;
	telemetryUrlChanged: boolean;
	dotcomUrlChanged: boolean;
	proxyUrlChanged: boolean;
}

export interface IDomainService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeDomains: Event<IDomainChangeEvent>;
}
export const IDomainService = createServiceIdentifier<IDomainService>('IDomainService');
