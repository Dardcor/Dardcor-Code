/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class DiffChange {

	public originalStart: number;

	public originalLength: number;

	public modifiedStart: number;

	public modifiedLength: number;

	constructor(originalStart: number, originalLength: number, modifiedStart: number, modifiedLength: number) {
		this.originalStart = originalStart;
		this.originalLength = originalLength;
		this.modifiedStart = modifiedStart;
		this.modifiedLength = modifiedLength;
	}

	public getOriginalEnd() {
		return this.originalStart + this.originalLength;
	}

	public getModifiedEnd() {
		return this.modifiedStart + this.modifiedLength;
	}
}
