/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class SedFileWriteParser {
	readonly commandName = 'sed';

	canHandle(commandText: string): boolean {
		if (!commandText.match(/^sed\s+/)) {
			return false;
		}

		const inPlaceRegex = /(?:^|\s)(-[a-zA-Z]*[iI][a-zA-Z]*\S*|--in-place(?:=\S*)?|(-i|-I)\s*'[^']*'|(-i|-I)\s*"[^"]*")(?:\s|$)/;
		return inPlaceRegex.test(commandText);
	}

	extractFileWrites(commandText: string): string[] {
		const tokens = this._tokenizeCommand(commandText);
		return this._extractFileTargets(tokens);
	}

	private _tokenizeCommand(commandText: string): string[] {
		const tokens: string[] = [];
		let current = '';
		let inSingleQuote = false;
		let inDoubleQuote = false;
		let escaped = false;

		for (let i = 0; i < commandText.length; i++) {
			const char = commandText[i];

			if (escaped) {
				current += char;
				escaped = false;
				continue;
			}

			if (char === '\\' && !inSingleQuote) {
				escaped = true;
				current += char;
				continue;
			}

			if (char === '\'' && !inDoubleQuote) {
				inSingleQuote = !inSingleQuote;
				current += char;
				continue;
			}

			if (char === '"' && !inSingleQuote) {
				inDoubleQuote = !inDoubleQuote;
				current += char;
				continue;
			}

			if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
				if (current) {
					tokens.push(current);
					current = '';
				}
				continue;
			}

			current += char;
		}

		if (current) {
			tokens.push(current);
		}

		return tokens;
	}

	private _extractFileTargets(tokens: string[]): string[] {
		if (tokens.length === 0 || tokens[0] !== 'sed') {
			return [];
		}

		const files: string[] = [];
		let i = 1;
		let foundScript = false;

		while (i < tokens.length) {
			const token = tokens[i];

			if (token.startsWith('--')) {
				if (token === '--in-place' || token.startsWith('--in-place=')) {
					i++;
					continue;
				}
				if (token === '--expression' || token === '--file') {
					i += 2;
					foundScript = true;
					continue;
				}
				if (token.startsWith('--expression=') || token.startsWith('--file=')) {
					i++;
					foundScript = true;
					continue;
				}
				i++;
				continue;
			}

			if (token.startsWith('-') && token.length > 1 && token[1] !== '-') {
				const flags = token.slice(1);

				const iIndex = flags.indexOf('i');
				const IIndex = flags.indexOf('I');
				const inPlaceIndex = iIndex >= 0 ? iIndex : IIndex;

				if (inPlaceIndex >= 0 && inPlaceIndex < flags.length - 1) {
					i++;
					continue;
				}

				if ((flags.endsWith('i') || flags.endsWith('I')) && i + 1 < tokens.length) {
					const nextToken = tokens[i + 1];
					if (nextToken === '\'\'' || nextToken === '""') {
						i += 2;
						continue;
					}
					if ((nextToken.startsWith('\'') && nextToken.endsWith('\'')) || (nextToken.startsWith('"') && nextToken.endsWith('"'))) {
						const unquoted = nextToken.slice(1, -1);
						if (unquoted.startsWith('.') && unquoted.length <= 10 && !unquoted.includes('/')) {
							i += 2;
							continue;
						}
					}
				}

				if (flags.includes('e') || flags.includes('f')) {
					const eIndex = flags.indexOf('e');
					const fIndex = flags.indexOf('f');
					const optIndex = eIndex >= 0 ? eIndex : fIndex;

					if (optIndex < flags.length - 1) {
						foundScript = true;
						i++;
						continue;
					}

					foundScript = true;
					i += 2;
					continue;
				}

				i++;
				continue;
			}

			if (!foundScript) {
				foundScript = true;
				i++;
				continue;
			}

			let file = token;
			if ((file.startsWith('\'') && file.endsWith('\'')) || (file.startsWith('"') && file.endsWith('"'))) {
				file = file.slice(1, -1);
			}
			files.push(file);
			i++;
		}

		return files;
	}
}
