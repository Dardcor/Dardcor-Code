/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum BlockMode {
	Parsing = 'parsing',
	Server = 'server',
	ParsingAndServer = 'parsingandserver',
	MoreMultiline = 'moremultiline',
}

export function shouldDoParsingTrimming(blockMode: BlockMode): boolean {
	return [BlockMode.Parsing, BlockMode.ParsingAndServer, BlockMode.MoreMultiline].includes(blockMode);
}

export function shouldDoServerTrimming(blockMode: BlockMode): boolean {
	return [BlockMode.Server, BlockMode.ParsingAndServer].includes(blockMode);
}
