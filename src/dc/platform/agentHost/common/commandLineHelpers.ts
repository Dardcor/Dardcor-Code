/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

export interface IExtractedCdPrefix {
	readonly directory: string;
	readonly command: string;
}

export function extractCdPrefix(commandLine: string, isPowerShell: boolean): IExtractedCdPrefix | undefined {
	const cdPrefixMatch = commandLine.match(
		isPowerShell
			? /^(?:cd(?: \/d)?|Set-Location(?: -Path)?) (?<dir>"[^"]*"|[^\s]+) *(?:&&|;|\r?\n)\s*(?<suffix>[\s\S]+)$/i
			: /^cd (?<dir>"[^"]*"|[^\s]+) *(?:&&|\r?\n)\s*(?<suffix>[\s\S]+)$/
	);
	const cdDir = cdPrefixMatch?.groups?.dir;
	const cdSuffix = cdPrefixMatch?.groups?.suffix;
	if (cdDir && cdSuffix) {
		let cdDirPath = cdDir;
		if (cdDirPath.startsWith('"') && cdDirPath.endsWith('"')) {
			cdDirPath = cdDirPath.slice(1, -1);
		}
		return { directory: cdDirPath, command: cdSuffix };
	}
	return undefined;
}

export function stripRedundantCdPrefix(
	toolName: string,
	parameters: Record<string, unknown> | undefined,
	workingDirectory: URI | undefined,
): boolean {
	if (!workingDirectory || !parameters) {
		return false;
	}
	const isBash = toolName === 'bash';
	const isPowerShell = toolName === 'powershell';
	if (!isBash && !isPowerShell) {
		return false;
	}
	const command = parameters.command;
	if (typeof command !== 'string') {
		return false;
	}
	const extracted = extractCdPrefix(command, isPowerShell);
	if (!extracted) {
		return false;
	}
	if (!sameDirectory(extracted.directory, workingDirectory)) {
		return false;
	}
	parameters.command = extracted.command;
	return true;
}

function sameDirectory(extractedDir: string, workingDirectory: URI): boolean {
	if (!extractedDir) {
		return false;
	}
	const trim = (p: string) => p.replace(/[\\/]+$/, '');
	const trimmedExtracted = trim(extractedDir);
	const trimmedWd = trim(workingDirectory.fsPath);
	if (!trimmedExtracted || !trimmedWd) {
		return false;
	}
	let extractedUri: URI;
	let wdUri: URI;
	try {
		extractedUri = URI.file(trimmedExtracted);
		wdUri = URI.file(trimmedWd);
	} catch {
		return false;
	}
	return extUriBiasedIgnorePathCase.isEqual(extractedUri, wdUri);
}
