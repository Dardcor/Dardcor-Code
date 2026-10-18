/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export function flakySuite(title: string, fn: () => void) {
	return suite(title, function () {

		this.retries(3);
		this.timeout(1000 * 20);

		fn.call(this);
	});
}

export const randomBoolean = (): boolean => {
	return Math.random() > 0.5;
};
