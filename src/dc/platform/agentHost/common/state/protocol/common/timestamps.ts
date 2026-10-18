/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export function addMillisecondsToTimestamp(timestamp: string, duration: number): string {
	return new Date(Date.parse(timestamp) + duration).toISOString();
}
