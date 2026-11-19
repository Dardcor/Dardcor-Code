/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function parseEnvFile(src: string) {
	const result = new Map<string, string>();

	const normalizedSrc = src.replace(/\r\n?/g, '\n');
	const lines = normalizedSrc.split('\n');

	for (let line of lines) {
		line = line.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const [key, value] = parseLine(line);
		if (key) {
			result.set(key, value);
		}
	}

	return result;

	function parseLine(line: string): [string, string] | [null, null] {
		if (line.startsWith('export ')) {
			line = line.substring(7).trim();
		}

		const separatorIndex = findIndexOutsideQuotes(line, c => c === '=' || c === ':');
		if (separatorIndex === -1) {
			return [null, null];
		}

		const key = line.substring(0, separatorIndex).trim();
		let value = line.substring(separatorIndex + 1).trim();

		const commentIndex = findIndexOutsideQuotes(value, c => c === '#');
		if (commentIndex !== -1) {
			value = value.substring(0, commentIndex).trim();
		}

		if (value.length >= 2) {
			const firstChar = value[0];
			const lastChar = value[value.length - 1];

			if ((firstChar === '"' && lastChar === '"') ||
				(firstChar === '\'' && lastChar === '\'') ||
				(firstChar === '`' && lastChar === '`')) {
				value = value.substring(1, value.length - 1);

				if (firstChar === '"') {
					value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
				}
			}
		}

		return [key, value];
	}

	function findIndexOutsideQuotes(text: string, predicate: (char: string) => boolean): number {
		let inQuote = false;
		let quoteChar = '';

		for (let i = 0; i < text.length; i++) {
			const char = text[i];

			if (inQuote) {
				if (char === quoteChar && text[i - 1] !== '\\') {
					inQuote = false;
				}
			} else if (char === '"' || char === '\'' || char === '`') {
				inQuote = true;
				quoteChar = char;
			} else if (predicate(char)) {
				return i;
			}
		}

		return -1;
	}
}
