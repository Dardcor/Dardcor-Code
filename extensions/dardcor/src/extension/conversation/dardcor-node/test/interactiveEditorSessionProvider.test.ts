/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Diagnostic, Range, TextDocument, workspace } from 'vscode';
import { rangeSpanningDiagnostics } from '../../../../platform/languages/common/languageDiagnosticsService';
import { IParserService } from '../../../../platform/parser/node/parserService';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { Position } from '../../../../dardcorTypes';
import { findFixRangeOfInterest } from '../../../context/node/resolvers/fixSelection';
import { createExtensionTestingServices } from '../../../test/dardcor-node/services';

suite('findFixRangeOfInterest', function () {
	let accessor: ITestingServicesAccessor;
	let typeScriptDoc: TextDocument;
	let javaDoc: TextDocument;
	let pythonDoc: TextDocument;
	let cppDoc: TextDocument;

	suiteSetup(async function () {
		accessor = createExtensionTestingServices().createTestingAccessor();
		await setupTypeScriptDoc();
		await setupPythonDoc();
		await setupJavaDoc();
		await setupCppDoc();
	});

	async function setupTypeScriptDoc() {
		const typeScriptContent = [
			'class Person {',
			'	readonly myName = "Paul";',
			'	readonly myFriendName = "Marc";',
			'	readonly threshold = 3;',
			'',
			'	sayMyName() {',
			'		return this.myName;',
			'	}',
			'	sayHi() {',
			'		return "hi";',
			'	}',
			'	speak() {',
			'		const salute = () => {',
			'			for (let i = 0; i < 5; i++) {',
			'				if (i > this.threshold) {',
			'',
			'                  const x = 3;',
			'                  const x = 10;',
			'					|r|eturn this.sayHi() + this.sayMyName();',
			'',
			'				}',
			'			}',
			'		};',
			'		salute();',
			'	}',
			'}',
		].join('\n');

		typeScriptDoc = await workspace.openTextDocument({
			language: 'typescript',
			content: typeScriptContent,
		});
	}

	test('typescript - max number of lines 4', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, typeScriptDoc, 4, [16, 18]);
	});

	test('typescript - max number of lines 10', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, typeScriptDoc, 10, [13, 21]);
	});

	test('typescript - max number of lines 15', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, typeScriptDoc, 15, [11, 24]);
	});

	async function setupPythonDoc() {
		const pythonContent = [
			'participant = ["Monalisa", "Akbar Hossain",',
			'				"Jakir Hasan", "Zahadur Rahman", "Zenifer Lopez"]',
			'',
			'def selected_person(part):',
			'	selected = ["Akbar Hossain", "Zillur Rahman", "Monalisa"]',
			'	if (part in selected):',
			'		|r|eturn True',
			'	return False',
			'',
			'selectedList = filter(selected_person, participant)',
			'',
			'print("The selected candidates are:")',
			'for candidate in selectedList:',
			'	print(candidate)',
		].join('\n');

		pythonDoc = await workspace.openTextDocument({
			language: 'python',
			content: pythonContent,
		});
	}

	test('python - max number of lines 5', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, pythonDoc, 5, [3, 7]);
	});

	test('python - max number of lines 11', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, pythonDoc, 11, [0, 9]);
	});

	test('python - max number of lines 16', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, pythonDoc, 16, [0, 13]);
	});

	async function setupJavaDoc() {
		const javaContent = [
			'public class Main {',
			'	public static void main(String[] args) {',
			'		final int myNum = 15;',
			'		for (int i = 0; i <= 10; i = i + 2) {',
			'			|S|ystem.out.println(i);',
			'		}',
			'		myNum = 20; // will generate an error',
			'		System.out.println(myNum);',
			'	}',
			'}',
		].join('\n');

		javaDoc = await workspace.openTextDocument({
			language: 'java',
			content: javaContent,
		});
	}

	test('java - max number of lines 3', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, javaDoc, 3, [3, 5]);
	});

	test('java - max number of lines 5', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, javaDoc, 5, [2, 6]);
	});

	test('java - max number of lines 9', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, javaDoc, 9, [1, 8]);
	});

	async function setupCppDoc() {
		const cppContent = [
			'bool isArmstrong(int x)',
			'{',
			'	|/|/ Calling order function',
			'	int n = order(x);',
			'	int temp = x, sum = 0;',
			'',
			'	while (temp) {',
			'		int r = temp % 10;',
			'		sum += power(r, n);',
			'		temp = temp / 10;',
			'	}',
			'',
			'	// If satisfies Armstrong',
			'	// condition',
			'	return (sum == x);',
			'}',
		].join('\n');

		cppDoc = await workspace.openTextDocument({
			language: 'cpp',
			content: cppContent,
		});
	}

	test('cpp - max length 4', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, cppDoc, 4, [2, 4]);
	});

	test('cpp - max length 11', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, cppDoc, 11, [2, 10]);
	});

	test('cpp - max length 12', async function () {
		await assertfindFixRangeOfInterestAsync(accessor, cppDoc, 12, [2, 10]);
	});
});

async function assertfindFixRangeOfInterestAsync(accessor: ITestingServicesAccessor, _document: TextDocument, maximumNumberOfLines: number, expectedLineRange: [number, number]) {
	let startPosition: Position | undefined;
	let endPosition: Position | undefined;
	const documentLineCount = _document.lineCount;
	for (let index = 0; index < documentLineCount; index++) {
		const line = _document.lineAt(index);
		if (!line.text.includes('|')) {
			continue;
		}
		const firstPipeIndex = line.text.indexOf('|');
		const position = new Position(index, firstPipeIndex);
		if (!startPosition) {
			startPosition = position;
			const secondPipeIndex = line.text.indexOf('|', firstPipeIndex + 1) - 1;
			endPosition = secondPipeIndex !== -1 ? new Position(index, secondPipeIndex) : undefined;
			continue;
		}
		if (!endPosition) {
			endPosition = position;
			continue;
		}
		throw new Error('More than two | in the document');
	}
	if (!startPosition || !endPosition) {
		throw new Error('Less than two | in the document');
	}
	const document = await workspace.openTextDocument({
		language: _document.languageId,
		content: _document.getText().replace(/\|/g, ''),
	});
	const treeSitterAST = accessor.get(IParserService).getTreeSitterAST(document);
	assert(treeSitterAST);
	const diagnostics: Diagnostic[] = [new Diagnostic(new Range(startPosition, endPosition), 'placeholder')];
	const diagnosticsRange = rangeSpanningDiagnostics(diagnostics);
	const rangeOfInterest = await findFixRangeOfInterest(treeSitterAST, diagnosticsRange, maximumNumberOfLines);
	assert.deepStrictEqual(rangeOfInterest!.start.line, expectedLineRange[0]);
	assert.deepStrictEqual(rangeOfInterest!.end.line, expectedLineRange[1]);
}
