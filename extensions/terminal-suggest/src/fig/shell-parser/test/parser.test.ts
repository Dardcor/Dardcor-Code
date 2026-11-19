/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { parse } from '../parser';
import { strictEqual } from 'node:assert';

function parseCommand(command: string): string {
	return JSON.stringify(parse(command), null, '  ');
}

function getData(
	filePath: string,
	nameComment: string,
): [name: string, value: string][] {
	if (!fs.existsSync(filePath)) {
		fs.writeFileSync(filePath, '');
		return [];
	}
	return fs
		.readFileSync(filePath, { encoding: 'utf8' })
		.replaceAll('\r\n', '\n')
		.split('\n\n')
		.map((testCase) => {
			const firstNewline = testCase.indexOf('\n');
			const title = testCase.slice(0, firstNewline);
			const block = testCase.slice(firstNewline);
			return [title.slice(nameComment.length).trim(), block.trim()];
		});
}




suite('fig/shell-parser/ fixtures', () => {
	const fixturesPath = path.join(__dirname, '../../../../fixtures/shell-parser');
	const fixtures = fs.readdirSync(fixturesPath);
	for (const fixture of fixtures) {
		suite(fixture, () => {
			const inputFile = path.join(fixturesPath, fixture, 'input.sh');
			const outputFile = path.join(fixturesPath, fixture, 'output.txt');
			const inputData = new Map(getData(inputFile, '###'));
			const outputData = new Map(getData(outputFile, '//'));


			for (const [caseName, input] of inputData.entries()) {
				if (caseName) {
					test(caseName, () => {
						const output = outputData.get(caseName);
						strictEqual(parseCommand(input ?? ''), output);
					});
				}
			}
		});
	}
});
