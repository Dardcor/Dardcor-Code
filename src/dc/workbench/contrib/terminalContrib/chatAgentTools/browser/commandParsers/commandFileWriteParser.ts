/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICommandFileWriteParser {
	readonly commandName: string;

	canHandle(commandText: string): boolean;

	extractFileWrites(commandText: string): string[];
}
