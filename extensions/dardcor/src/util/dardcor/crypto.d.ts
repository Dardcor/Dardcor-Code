
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



declare global {

	interface SubtleCrypto {
		digest(algorithm: { name: string } | string, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer>;
	}

	interface Crypto {
		readonly subtle: SubtleCrypto;
		getRandomValues<T extends ArrayBufferView | null>(array: T): T;
		randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
	}

	var Crypto: {
		prototype: Crypto;
		new(): Crypto;
	};

	var crypto: Crypto;

}
export { }
