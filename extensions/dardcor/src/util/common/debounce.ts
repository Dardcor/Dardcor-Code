/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type DebounceState = {
	timer: any;
	reject: (reason?: any) => void;
};

export class Debouncer {
	private state: DebounceState | undefined;

	public async debounce(ms: number): Promise<void> {
		if (this.state) {
			clearTimeout(this.state.timer);
			this.state.reject();
			this.state = undefined;
		}
		return new Promise<void>((resolve, reject) => {
			this.state = {
				timer: setTimeout(() => resolve(), ms),
				reject,
			};
		});
	}
}

export function debounce<T extends (...args: any[]) => any>(
	ms: number,
	callback: T
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
	let timer: any | undefined;

	return (...args: Parameters<T>) => {
		if (timer) {
			clearTimeout(timer);
		}
		return new Promise<ReturnType<T>>(resolve => {
			timer = setTimeout(() => {
				const returnValue = callback(...args) as ReturnType<T>;
				resolve(returnValue);
			}, ms);
		});
	};
}
