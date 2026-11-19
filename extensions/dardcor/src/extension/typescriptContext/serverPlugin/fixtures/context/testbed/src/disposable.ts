/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Disposable {



	dispose(): void;
}

export namespace Disposable {
	export function create(func: () => void): Disposable {
		return {
			dispose: func
		};
	}
}
