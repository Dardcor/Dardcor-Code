/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SimulationStorage, SimulationStorageValue } from './simulationStorage';

export class AdhocRequestOptions {

	public readonly systemMessage: SimulationStorageValue<string>;

	public readonly userMessage: SimulationStorageValue<string>;

	public readonly model: SimulationStorageValue<string>;

	constructor(storage: SimulationStorage) {
		this.systemMessage = new SimulationStorageValue(storage, 'adhocRequestSystemMessage', '');
		this.userMessage = new SimulationStorageValue(storage, 'adhocRequestUserMessage', '');
		this.model = new SimulationStorageValue(storage, 'adhocRequestModel', '');
	}
}
