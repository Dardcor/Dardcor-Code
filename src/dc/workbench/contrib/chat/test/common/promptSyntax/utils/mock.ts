/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from '../../../../../../../base/common/assert.js';
import { isOneOf } from '../../../../../../../base/common/types.js';



export function mockObject<TObject extends object>(
	overrides: Partial<TObject>,
): TObject {
	overrides = Object.freeze(overrides);

	const keys: (keyof Partial<TObject>)[] = [];
	for (const key in overrides) {
		if (Object.hasOwn(overrides, key)) {
			keys.push(key);
		}
	}

	const mocked: object = new Proxy(
		{},
		{
			get: <T extends keyof TObject>(
				_target: TObject,
				key: string | number | Symbol,
			): TObject[T] => {
				assert(
					isOneOf(key, keys),
					`The '${key}' is not mocked.`,
				);

				return overrides[key as T] as TObject[T];
			},
		});

	return mocked as TObject;
}

type TAnyService = {
	readonly _serviceBrand: undefined;
};

export function mockService<TService extends TAnyService>(
	overrides: Partial<TService>,
): TService {
	return mockObject(overrides);
}
