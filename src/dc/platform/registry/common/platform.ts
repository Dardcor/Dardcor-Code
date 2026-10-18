/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Assert from '../../../base/common/assert.js';
import * as Types from '../../../base/common/types.js';

export interface IRegistry {

	add(id: string, data: any): void;

	knows(id: string): boolean;

	as<T>(id: string): T;
}

class RegistryImpl implements IRegistry {

	private readonly data = new Map<string, any>();

	public add(id: string, data: any): void {
		Assert.ok(Types.isString(id));
		Assert.ok(Types.isObject(data));
		Assert.ok(!this.data.has(id), 'There is already an extension with this id');

		this.data.set(id, data);
	}

	public knows(id: string): boolean {
		return this.data.has(id);
	}

	public as(id: string): any {
		return this.data.get(id) || null;
	}

	public dispose() {
		this.data.forEach((value) => {
			if (Types.isFunction(value.dispose)) {
				value.dispose();
			}
		});
		this.data.clear();
	}

}

export const Registry: IRegistry = new RegistryImpl();
