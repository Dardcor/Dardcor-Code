/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export type JsonRecordFormat = 'array' | 'jsonl';

export function inferJsonRecordFormat(inputPath: string): JsonRecordFormat {
	const ext = path.extname(inputPath).toLowerCase();
	return ext === '.jsonl' || ext === '.ndjson' ? 'jsonl' : 'array';
}

export async function* streamJsonRecords<T = unknown>(inputPath: string): AsyncGenerator<T> {
	const format = inferJsonRecordFormat(inputPath);
	const stream = fs.createReadStream(inputPath, { encoding: 'utf8' });

	try {
		if (format === 'jsonl') {
			yield* streamJsonLines<T>(stream);
		} else {
			yield* streamJsonArray<T>(stream);
		}
	} finally {
		stream.destroy();
	}
}

function isWhitespace(ch: string): boolean {
	return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

async function* streamJsonLines<T>(stream: NodeJS.ReadableStream): AsyncGenerator<T> {
	let line = '';
	for await (const chunk of stream) {
		const text = chunk as string;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (ch === '\n' || ch === '\r') {
				const trimmed = line.trim();
				line = '';
				if (trimmed.length > 0) {
					yield JSON.parse(trimmed) as T;
				}
			} else {
				line += ch;
			}
		}
	}
	const trimmed = line.trim();
	if (trimmed.length > 0) {
		yield JSON.parse(trimmed) as T;
	}
}

async function* streamJsonArray<T>(stream: NodeJS.ReadableStream): AsyncGenerator<T> {
	let arrayStarted = false;
	let arrayEnded = false;
	let depth = 0;
	let inString = false;
	let escaped = false;
	let current = '';
	let hasContent = false;
	let elementsYielded = 0;
	let pendingElement = false;
	let trailingChar = '';

	for await (const chunk of stream) {
		const text = chunk as string;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];

			if (!arrayStarted) {
				if (isWhitespace(ch)) {
					continue;
				}
				if (ch === '[') {
					arrayStarted = true;
					pendingElement = true;
					continue;
				}
				throw new Error(`Expected '[' at start of JSON array input, got '${ch}'`);
			}

			if (arrayEnded) {
				if (!isWhitespace(ch)) {
					trailingChar = ch;
					break;
				}
				continue;
			}

			if (inString) {
				current += ch;
				if (escaped) {
					escaped = false;
				} else if (ch === '\\') {
					escaped = true;
				} else if (ch === '"') {
					inString = false;
				}
				continue;
			}

			if (ch === '"') {
				inString = true;
				current += ch;
				hasContent = true;
				continue;
			}

			if (ch === '{' || ch === '[') {
				depth++;
				current += ch;
				hasContent = true;
				continue;
			}

			if (ch === '}' || ch === ']') {
				if (ch === ']' && depth === 0) {
					const trimmed = current.trim();
					current = '';
					hasContent = false;
					if (trimmed.length > 0) {
						yield JSON.parse(trimmed) as T;
						elementsYielded++;
						pendingElement = false;
					} else if (pendingElement && elementsYielded > 0) {
						throw new Error('Unexpected \']\' after trailing comma in JSON array');
					}
					arrayEnded = true;
					continue;
				}
				depth--;
				current += ch;
				hasContent = true;
				continue;
			}

			if (ch === ',' && depth === 0) {
				const trimmed = current.trim();
				current = '';
				hasContent = false;
				if (trimmed.length === 0) {
					throw new Error('Unexpected \',\' (missing element) in JSON array');
				}
				yield JSON.parse(trimmed) as T;
				elementsYielded++;
				pendingElement = true;
				continue;
			}

			if (!hasContent && isWhitespace(ch)) {
				continue;
			}

			current += ch;
			if (!isWhitespace(ch)) {
				hasContent = true;
			}
		}

		if (arrayEnded && trailingChar) {
			break;
		}
	}

	if (!arrayStarted) {
		return;
	}

	if (!arrayEnded) {
		throw new Error('Unexpected end of input: JSON array was not closed');
	}

	if (trailingChar) {
		throw new Error(`Unexpected '${trailingChar}' after end of JSON array`);
	}
}
