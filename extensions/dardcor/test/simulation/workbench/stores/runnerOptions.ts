/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mobx from 'mobx';
import { SimulationStorage, SimulationStorageValue } from './simulationStorage';

export enum CacheMode {
	Disable = 'disable',
	Require = 'require',
	Default = 'default',
	Regenerate = 'regenerate',
}

export class RunnerOptions {
	public readonly grep: SimulationStorageValue<string>;

	public readonly cacheMode: SimulationStorageValue<CacheMode>;

	public readonly noFetch: SimulationStorageValue<boolean>;

	public readonly n: SimulationStorageValue<string>;

	public readonly additionalArgs: SimulationStorageValue<string>;

	constructor(storage: SimulationStorage) {
		this.grep = new SimulationStorageValue(storage, 'grep', '');
		this.cacheMode = new SimulationStorageValue(storage, 'cacheMode', CacheMode.Default);
		this.noFetch = new SimulationStorageValue(storage, 'noFetch', false);
		this.n = new SimulationStorageValue(storage, 'n', '');
		this.additionalArgs = new SimulationStorageValue(storage, 'additionalArgs', '');
		mobx.makeObservable(this);
	}
}
