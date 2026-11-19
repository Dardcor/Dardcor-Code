/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function secondsToHumanReadableTime(seconds: number): string {
	if (seconds < 90) {
		return `${seconds} seconds`;
	}

	const minutes = Math.floor(seconds / 60);
	if (seconds <= 5400) {
		return `${minutes} minutes`;
	}

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	let result = `${hours} hours`;
	if (remainingMinutes > 0) {
		result += ` ${remainingMinutes} minutes`;
	}

	return result;
}
