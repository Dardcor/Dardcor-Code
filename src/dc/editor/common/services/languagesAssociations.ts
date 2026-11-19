/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedPattern, parse } from '../../../base/common/glob.js';
import { Mimes } from '../../../base/common/mime.js';
import { Schemas } from '../../../base/common/network.js';
import { basename, posix } from '../../../base/common/path.js';
import { DataUri } from '../../../base/common/resources.js';
import { endsWithIgnoreCase, equals, startsWithUTF8BOM } from '../../../base/common/strings.js';
import { URI } from '../../../base/common/uri.js';
import { PLAINTEXT_LANGUAGE_ID } from '../languages/modesRegistry.js';

export interface ILanguageAssociation {
	readonly id: string;
	readonly mime: string;
	readonly filename?: string;
	readonly extension?: string;
	readonly filepattern?: string;
	readonly firstline?: RegExp;
}

interface ILanguageAssociationItem extends ILanguageAssociation {
	readonly userConfigured: boolean;
	readonly filepatternParsed?: ParsedPattern;
	readonly filepatternOnPath?: boolean;
}

let registeredAssociations: ILanguageAssociationItem[] = [];
let nonUserRegisteredAssociations: ILanguageAssociationItem[] = [];
let userRegisteredAssociations: ILanguageAssociationItem[] = [];

export function registerPlatformLanguageAssociation(association: ILanguageAssociation, warnOnOverwrite = false): void {
	_registerLanguageAssociation(association, false, warnOnOverwrite);
}

export function registerConfiguredLanguageAssociation(association: ILanguageAssociation): void {
	_registerLanguageAssociation(association, true, false);
}

function _registerLanguageAssociation(association: ILanguageAssociation, userConfigured: boolean, warnOnOverwrite: boolean): void {

	const associationItem = toLanguageAssociationItem(association, userConfigured);
	registeredAssociations.push(associationItem);
	if (!associationItem.userConfigured) {
		nonUserRegisteredAssociations.push(associationItem);
	} else {
		userRegisteredAssociations.push(associationItem);
	}

	if (warnOnOverwrite && !associationItem.userConfigured) {
		registeredAssociations.forEach(a => {
			if (a.mime === associationItem.mime || a.userConfigured) {
				return;
			}

			if (associationItem.extension && a.extension === associationItem.extension) {
				console.warn(`Overwriting extension <<${associationItem.extension}>> to now point to mime <<${associationItem.mime}>>`);
			}

			if (associationItem.filename && a.filename === associationItem.filename) {
				console.warn(`Overwriting filename <<${associationItem.filename}>> to now point to mime <<${associationItem.mime}>>`);
			}

			if (associationItem.filepattern && a.filepattern === associationItem.filepattern) {
				console.warn(`Overwriting filepattern <<${associationItem.filepattern}>> to now point to mime <<${associationItem.mime}>>`);
			}

			if (associationItem.firstline && a.firstline === associationItem.firstline) {
				console.warn(`Overwriting firstline <<${associationItem.firstline}>> to now point to mime <<${associationItem.mime}>>`);
			}
		});
	}
}

function toLanguageAssociationItem(association: ILanguageAssociation, userConfigured: boolean): ILanguageAssociationItem {
	return {
		id: association.id,
		mime: association.mime,
		filename: association.filename,
		extension: association.extension,
		filepattern: association.filepattern,
		firstline: association.firstline,
		userConfigured: userConfigured,
		filepatternParsed: association.filepattern ? parse(association.filepattern, { ignoreCase: true }) : undefined,
		filepatternOnPath: association.filepattern ? association.filepattern.indexOf(posix.sep) >= 0 : false
	};
}

export function clearPlatformLanguageAssociations(): void {
	registeredAssociations = registeredAssociations.filter(a => a.userConfigured);
	nonUserRegisteredAssociations = [];
}

export function clearConfiguredLanguageAssociations(): void {
	registeredAssociations = registeredAssociations.filter(a => !a.userConfigured);
	userRegisteredAssociations = [];
}

interface IdAndMime {
	id: string;
	mime: string;
}

export function getMimeTypes(resource: URI | null, firstLine?: string): string[] {
	return getAssociations(resource, firstLine).map(item => item.mime);
}

export function getLanguageIds(resource: URI | null, firstLine?: string): string[] {
	return getAssociations(resource, firstLine).map(item => item.id);
}

function getAssociations(resource: URI | null, firstLine?: string): IdAndMime[] {
	let path: string | undefined;
	if (resource) {
		switch (resource.scheme) {
			case Schemas.file:
				path = resource.fsPath;
				break;
			case Schemas.data: {
				const metadata = DataUri.parseMetaData(resource);
				path = metadata.get(DataUri.META_DATA_LABEL);
				break;
			}
			case Schemas.vscodeNotebookCell:
				path = undefined;
				break;
			default:
				path = resource.path;
		}
	}

	if (!path) {
		return [{ id: 'unknown', mime: Mimes.unknown }];
	}

	path = path.toLowerCase();

	const filename = basename(path);

	const configuredLanguage = getAssociationByPath(path, filename, userRegisteredAssociations);
	if (configuredLanguage) {
		return [configuredLanguage, { id: PLAINTEXT_LANGUAGE_ID, mime: Mimes.text }];
	}

	const registeredLanguage = getAssociationByPath(path, filename, nonUserRegisteredAssociations);
	if (registeredLanguage) {
		return [registeredLanguage, { id: PLAINTEXT_LANGUAGE_ID, mime: Mimes.text }];
	}

	if (firstLine) {
		const firstlineLanguage = getAssociationByFirstline(firstLine);
		if (firstlineLanguage) {
			return [firstlineLanguage, { id: PLAINTEXT_LANGUAGE_ID, mime: Mimes.text }];
		}
	}

	return [{ id: 'unknown', mime: Mimes.unknown }];
}

function getAssociationByPath(path: string, filename: string, associations: ILanguageAssociationItem[]): ILanguageAssociationItem | undefined {
	let filenameMatch: ILanguageAssociationItem | undefined = undefined;
	let patternMatch: ILanguageAssociationItem | undefined = undefined;
	let extensionMatch: ILanguageAssociationItem | undefined = undefined;

	for (let i = associations.length - 1; i >= 0; i--) {
		const association = associations[i];

		if (equals(filename, association.filename, true)) {
			filenameMatch = association;
			break;
		}

		if (association.filepattern) {
			if (!patternMatch || association.filepattern.length > patternMatch.filepattern!.length) {
				const target = association.filepatternOnPath ? path : filename;
				if (association.filepatternParsed?.(target)) {
					patternMatch = association;
				}
			}
		}

		if (association.extension) {
			if (!extensionMatch || association.extension.length > extensionMatch.extension!.length) {
				if (endsWithIgnoreCase(filename, association.extension)) {
					extensionMatch = association;
				}
			}
		}
	}

	if (filenameMatch) {
		return filenameMatch;
	}

	if (patternMatch) {
		return patternMatch;
	}

	if (extensionMatch) {
		return extensionMatch;
	}

	return undefined;
}

function getAssociationByFirstline(firstLine: string): ILanguageAssociationItem | undefined {
	if (startsWithUTF8BOM(firstLine)) {
		firstLine = firstLine.substring(1);
	}

	if (firstLine.length > 0) {

		for (let i = registeredAssociations.length - 1; i >= 0; i--) {
			const association = registeredAssociations[i];
			if (!association.firstline) {
				continue;
			}

			const matches = firstLine.match(association.firstline);
			if (matches && matches.length > 0) {
				return association;
			}
		}
	}

	return undefined;
}
