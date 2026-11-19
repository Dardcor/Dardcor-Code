/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function hasKey<K extends PropertyKey, R = unknown>(value: unknown, key: K): value is { [key in K]: R } {
	return value !== null && typeof value === 'object' && key in value;
}

export function getKey<K extends PropertyKey, R = unknown>(value: unknown, key: K): R | undefined {
	return hasKey<K, R>(value, key) ? value[key] : undefined;
}
