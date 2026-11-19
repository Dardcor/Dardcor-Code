/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum Constants {






	MAX_SAFE_SMALL_INTEGER = 1 << 30,







	MIN_SAFE_SMALL_INTEGER = -(1 << 30),




	MAX_UINT_8 = 255, // 2^8 - 1




	MAX_UINT_16 = 65535, // 2^16 - 1




	MAX_UINT_32 = 4294967295, // 2^32 - 1

	UNICODE_SUPPLEMENTARY_PLANE_BEGIN = 0x010000
}

export function toUint8(v: number): number {
	if (v < 0) {
		return 0;
	}
	if (v > Constants.MAX_UINT_8) {
		return Constants.MAX_UINT_8;
	}
	return v | 0;
}

export function toUint32(v: number): number {
	if (v < 0) {
		return 0;
	}
	if (v > Constants.MAX_UINT_32) {
		return Constants.MAX_UINT_32;
	}
	return v | 0;
}
