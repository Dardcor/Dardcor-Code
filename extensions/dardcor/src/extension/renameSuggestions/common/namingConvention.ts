/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum NamingConvention {
	CamelCase = 'camelCase',

	PascalCase = 'PascalCase',

	SnakeCase = 'snake_case',

	ScreamingSnakeCase = 'SCREAMING_SNAKE_CASE',

	CapitalSnakeCase = 'Capital_snake_case',

	KebabCase = 'kebab-case',

	Capitalized = 'Capitalized',

	Uppercase = 'Uppercase',

	LowerCase = 'lowercase',

	Unknown = 'Unknown',
}


export function guessNamingConvention(ident: string): NamingConvention {

	if (/^[a-z][a-z0-9]*$/.test(ident)) {
		return NamingConvention.LowerCase;
	}

	if (/^[a-z][a-zA-Z0-9]*$/.test(ident)) {
		return NamingConvention.CamelCase;
	}

	if (/^[a-z]+(_[a-z0-9]+)*$/.test(ident)) {
		return NamingConvention.SnakeCase;
	}

	if (/^[a-z]+(-[a-z0-9]+)*$/.test(ident)) {
		return NamingConvention.KebabCase;
	}

	if (/^[A-Z][a-z0-9]*$/.test(ident)) {
		return NamingConvention.Capitalized;
	}

	if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(ident)) {
		return NamingConvention.ScreamingSnakeCase;
	}

	if (/^[A-Z]+$/.test(ident)) {
		return NamingConvention.Uppercase;
	}

	if (/^[A-Z][a-zA-Z0-9]*$/.test(ident)) {
		return NamingConvention.PascalCase;
	}

	if (/^[A-Z][a-z0-9]*(_[a-z0-9]+)*$/.test(ident)) {
		return NamingConvention.CapitalSnakeCase;
	}

	return NamingConvention.Unknown;
}

function chunksToCamelCase(chunks: string[]): string {
	return chunks.map((chunk, i) => {
		if (i === 0) {
			return chunk.toLowerCase();
		}

		return chunk.charAt(0).toUpperCase() + chunk.substring(1).toLowerCase();
	}).join('');
}

function chunksToPascalCase(chunks: string[]): string {
	return chunks.map(chunk => chunk.charAt(0).toUpperCase() + chunk.substring(1).toLowerCase()).join('');
}

function chunksToSnakeCase(chunks: string[]): string {
	return chunks.map(chunk => chunk.toLowerCase()).join('_');
}

function chunksToKebabCase(chunks: string[]): string {
	return chunks.map(chunk => chunk.toLowerCase()).join('-');
}

export function enforceNamingConvention(givenIdent: string, targetConvention: NamingConvention): string {

	const namingConvention = guessNamingConvention(givenIdent);

	if (namingConvention === targetConvention) {
		return givenIdent;
	} else {
		const chunks = chunkUpIdentByConvention(givenIdent, namingConvention);
		switch (targetConvention) {
			case NamingConvention.CamelCase:
				return chunksToCamelCase(chunks);
			case NamingConvention.PascalCase:
				return chunksToPascalCase(chunks);
			case NamingConvention.SnakeCase:
				return chunksToSnakeCase(chunks);
			case NamingConvention.ScreamingSnakeCase:
				return chunksToSnakeCase(chunks).toUpperCase();
			case NamingConvention.CapitalSnakeCase:
				return chunksToSnakeCase(chunks).charAt(0).toUpperCase() + chunksToSnakeCase(chunks).substring(1);
			case NamingConvention.KebabCase:
				return chunksToKebabCase(chunks);
			case NamingConvention.Capitalized:
				return chunksToCamelCase(chunks).charAt(0).toUpperCase() + chunksToCamelCase(chunks).substring(1);
			case NamingConvention.Uppercase:
				return givenIdent.toUpperCase();
			case NamingConvention.LowerCase:
				return givenIdent.toLowerCase();
			case NamingConvention.Unknown:
				return givenIdent;
		}
	}
}

export function chunkUpIdentByConvention(ident: string, identConvention: NamingConvention): string[] {
	switch (identConvention) {
		case NamingConvention.CamelCase:
		case NamingConvention.PascalCase:
			return ident.split(/(?=[A-Z])/);
		case NamingConvention.SnakeCase:
		case NamingConvention.ScreamingSnakeCase:
		case NamingConvention.CapitalSnakeCase:
		case NamingConvention.KebabCase:
			return ident.split(/[-_]/).map(chunk => chunk.toLowerCase());
		case NamingConvention.Capitalized:
		case NamingConvention.Uppercase:
		case NamingConvention.LowerCase:
		case NamingConvention.Unknown:
			return [ident];
	}
}
