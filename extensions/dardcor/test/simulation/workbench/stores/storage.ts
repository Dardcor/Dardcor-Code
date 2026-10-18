/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import * as simulationStorage from './simulationStorage';

export function useLocalStorageState<S>(key: string, initialVal: S | (() => S) | undefined, defaultValue: S): [S, (newV: S | ((oldV: S | undefined) => S)) => void] {

	let initVal = initialVal;

	if (initVal === undefined) {
		initVal = getLocalStorageValue(key, defaultValue);
	}

	const [v, setV] = useState(initVal);

	const setVWithLocalStorageBacking = (newV: S | ((oldV: S | undefined) => S)) => {
		let valueToSet: S;
		if (typeof newV === 'function') {
			valueToSet = (newV as Function)(v);
		} else {
			valueToSet = newV;
		}
		setLocalStorageValue(key, valueToSet);
		setV(valueToSet);
	};

	return [v, setVWithLocalStorageBacking];
}


export function getLocalStorageValue<T>(key: string, defaultValue: T): T {
	const item = localStorage.getItem(simulationStorage.PREFIX + key);
	if (item) {
		return JSON.parse(item) as T;
	} else {
		return defaultValue;
	}
}

export function setLocalStorageValue<T>(key: string, valueToSet: T): void {
	localStorage.setItem(simulationStorage.PREFIX + key, JSON.stringify(valueToSet));
}
