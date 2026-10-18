/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getNLSMessages(): string[] {
	return (globalThis as any)._DCCODE_NLS_MESSAGES ?? (globalThis as any)._VSCODE_NLS_MESSAGES;
}

export function getNLSLanguage(): string | undefined {
	return (globalThis as any)._DCCODE_NLS_LANGUAGE ?? (globalThis as any)._VSCODE_NLS_LANGUAGE;
}

declare const document: { location?: { hash?: string } } | undefined;
const isPseudo = getNLSLanguage() === 'pseudo' || (typeof document !== 'undefined' && document.location && typeof document.location.hash === 'string' && document.location.hash.indexOf('pseudo=true') >= 0);

export interface ILocalizeInfo {
	key: string;
	comment: string[];
}

export interface ILocalizedString {
	original: string;
	value: string;
}

function _format(message: string, args: (string | number | boolean | undefined | null)[]): string {
	let result: string;

	if (args.length === 0) {
		result = message;
	} else {
		result = message.replace(/\{(\d+)\}/g, (match, rest) => {
			const index = rest[0];
			const arg = args[index];
			let result = match;
			if (typeof arg === 'string') {
				result = arg;
			} else if (typeof arg === 'number' || typeof arg === 'boolean' || arg === void 0 || arg === null) {
				result = String(arg);
			}
			return result;
		});
	}

	if (isPseudo) {
		result = '\uFF3B' + result.replace(/[aouei]/g, '$&$&') + '\uFF3D';
	}

	return result;
}

export function localize(info: ILocalizeInfo, message: string, ...args: (string | number | boolean | undefined | null)[]): string;

export function localize(key: string, message: string, ...args: (string | number | boolean | undefined | null)[]): string;

export function localize(data: ILocalizeInfo | string , message: string , ...args: (string | number | boolean | undefined | null)[]): string {
	if (typeof data === 'number') {
		return _format(lookupMessage(data, message), args);
	}
	return _format(message, args);
}

/**
 * Only used when built: Looks up the message in the global NLS table.
 * This table is being made available as a global through bootstrapping
 * depending on the target context.
 */
function lookupMessage(index: number, fallback: string | null): string {
	const message = getNLSMessages()?.[index];
	if (typeof message !== 'string') {
		if (typeof fallback === 'string') {
			return fallback;
		}
		console.warn(`[DCCODE NLS] Missing message index ${index}`);
		return '';
	}
	return message;
}

export function localize2(info: ILocalizeInfo, message: string, ...args: (string | number | boolean | undefined | null)[]): ILocalizedString;

export function localize2(key: string, message: string, ...args: (string | number | boolean | undefined | null)[]): ILocalizedString;

export function localize2(data: ILocalizeInfo | string , originalMessage: string, ...args: (string | number | boolean | undefined | null)[]): ILocalizedString {
	let message: string;
	if (typeof data === 'number') {
		message = lookupMessage(data, originalMessage);
	} else {
		message = originalMessage;
	}

	const value = _format(message, args);

	return {
		value,
		original: originalMessage === message ? value : _format(originalMessage, args)
	};
}

export interface INLSLanguagePackConfiguration {

	readonly translationsConfigFile: string;

	readonly messagesFile: string;

	readonly corruptMarkerFile: string;
}

export interface INLSConfiguration {

	readonly userLocale: string;

	readonly osLocale: string;

	readonly resolvedLanguage: string;

	readonly languagePack?: INLSLanguagePackConfiguration;

	readonly defaultMessagesFile: string;

	readonly locale: string;
	readonly availableLanguages: Record<string, string>;
	readonly _languagePackSupport?: boolean;
	readonly _languagePackId?: string;
	readonly _translationsConfigFile?: string;
	readonly _cacheRoot?: string;
	readonly _resolvedLanguagePackCoreLocation?: string;
	readonly _corruptedFile?: string;
}

export interface ILanguagePack {
	readonly hash: string;
	readonly label: string | undefined;
	readonly extensions: {
		readonly extensionIdentifier: { readonly id: string; readonly uuid?: string };
		readonly version: string;
	}[];
	readonly translations: Record<string, string | undefined>;
}

export type ILanguagePacks = Record<string, ILanguagePack | undefined>;
