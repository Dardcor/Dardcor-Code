/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';

export const IInteractionService = createServiceIdentifier<IInteractionService>('IInteractionService');

export interface IInteractionService {
	readonly _serviceBrand: undefined;

	readonly interactionId: string;

	startInteraction(): void;
}

export class InteractionService implements IInteractionService {
	_serviceBrand: undefined;
	private _interactionId: string = generateUuid();

	startInteraction(): void {
		this._interactionId = generateUuid();
	}

	public get interactionId(): string {
		return this._interactionId;
	}
}
