/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export class TaskSingler<T> {
	private _inFlightPromises = new Map<string, Promise<T>>();
	getOrCreate(key: string, promiseFactory: () => Promise<T>) {
		const inFlight = this._inFlightPromises.get(key);
		if (inFlight) {
			return inFlight;
		}

		const promise = promiseFactory().finally(() => this._inFlightPromises.delete(key));
		this._inFlightPromises.set(key, promise);

		return promise;
	}
}
