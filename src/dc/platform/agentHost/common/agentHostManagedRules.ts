/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const enum ManagedRuleFamily {
	Shell = 'Shell',
	Read = 'Read',
	Write = 'Write',
	Domain = 'Domain',
}

export function buildManagedFamilyRule(family: ManagedRuleFamily): string {
	return family;
}

export function buildManagedRule(family: ManagedRuleFamily, argument: string): string | undefined {
	if (!argument.trim() || !isValidRuleArgument(argument)) {
		return undefined;
	}
	switch (family) {
		case ManagedRuleFamily.Shell:
			return isValidShellArgument(argument) ? `${family}(${argument})` : undefined;
		case ManagedRuleFamily.Read:
		case ManagedRuleFamily.Write:
			return isValidPathArgument(argument) ? `${family}(${normalizePathSeparators(argument)})` : undefined;
		case ManagedRuleFamily.Domain:
			return isValidDomainArgument(argument) ? `${family}(${argument})` : undefined;
	}
}

function isValidRuleArgument(argument: string): boolean {
	return !argument.includes(')') && !argument.includes('\n');
}

function isValidShellArgument(argument: string): boolean {
	if (argument === '*') {
		return true;
	}
	const prefix = argument.endsWith(' *') ? argument.slice(0, -2).trimEnd() : argument;
	return prefix.length > 0;
}

function isValidPathArgument(argument: string): boolean {
	if (argument.startsWith('!')) {
		return false;
	}
	let depth = 0;
	for (const char of argument) {
		if (char === '{') {
			depth++;
		} else if (char === '}') {
			if (--depth < 0) {
				return false;
			}
		}
	}
	return depth === 0;
}

function normalizePathSeparators(argument: string): string {
	return argument.replace(/\\/g, '/');
}

function isValidDomainArgument(argument: string): boolean {
	if (argument.includes('$(') || argument.includes('${') || argument.includes('`')) {
		return false;
	}
	const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(argument);
	if (!hasScheme && argument.includes('//')) {
		return false;
	}
	if (argument === '*') {
		return false;
	}
	try {
		const url = new URL(hasScheme ? argument : `https://${argument}`);
		return url.hostname.length > 0;
	} catch {
		return false;
	}
}
