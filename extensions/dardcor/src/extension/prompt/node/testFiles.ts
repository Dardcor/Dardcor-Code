/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { ISearchService } from '../../../platform/search/common/searchService';
import { ITabsAndEditorsService } from '../../../platform/tabs/common/tabsAndEditorsService';
import { isMatch } from '../../../util/common/glob';
import { Schemas } from '../../../util/dardcor/base/common/network';
import * as resources from '../../../util/dardcor/base/common/resources';
import { URI } from '../../../util/dardcor/base/common/uri';

type TestHint = {
	prefix?: string;
	suffixes?: string[];
	location: 'sameFolder' | 'testFolder';
};

const nullTestHint: Required<TestHint> = {
	location: 'sameFolder',
	prefix: 'test_',
	suffixes: ['.test', '.spec', '_test', 'Test', '_spec', '_test', 'Tests', '.Tests', 'Spec'],
};

const testHintsByLanguage: Record<string, TestHint> = {
	csharp: { suffixes: ['Test'], location: 'testFolder' },
	dart: { suffixes: ['_test'], location: 'testFolder' },
	go: { suffixes: ['_test'], location: 'sameFolder' },
	java: { suffixes: ['Test'], location: 'testFolder' },
	javascript: { suffixes: ['.test', '.spec'], location: 'sameFolder' },
	javascriptreact: { suffixes: ['.test', '.spec'], location: 'sameFolder' },
	kotlin: { suffixes: ['Test'], location: 'testFolder' },
	php: { suffixes: ['Test'], location: 'testFolder' },
	powershell: { suffixes: ['.Tests'], location: 'testFolder' },
	python: { prefix: 'test_', suffixes: ['_test'], location: 'testFolder' },
	ruby: { suffixes: ['_test', '_spec'], location: 'testFolder' },
	rust: { suffixes: [''], location: 'testFolder' },
	swift: { suffixes: ['Tests'], location: 'testFolder' },
	typescript: { suffixes: ['.test', '.spec'], location: 'sameFolder' },
	typescriptreact: { suffixes: ['.test', '.spec'], location: 'sameFolder' },
};

export const suffix2Language: Record<string, keyof typeof testHintsByLanguage> = {
	cs: 'csharp',
	dart: 'dart',
	go: 'go',
	java: 'java',
	js: 'javascriptreact',
	kt: 'kotlin',
	php: 'php',
	ps1: 'powershell',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	swift: 'swift',
	ts: 'typescript',
	tsx: 'typescriptreact',
};

const testHintsBySuffix: { [key: string]: TestHint } = (function () {
	const result: { [key: string]: TestHint } = {};
	for (const [suffix, langId] of Object.entries(suffix2Language)) {
		result[suffix] = <TestHint>testHintsByLanguage[langId];
	}
	return result;
})();

export class TestFileFinder {

	constructor(
		@ISearchService private readonly _search: ISearchService,
		@ITabsAndEditorsService private readonly _tabs: ITabsAndEditorsService
	) {
	}

	private _findTabMatchingPattern(pattern: string): URI | undefined {

		const tab = this._tabs.tabs.find(info => {
			return info.uri && info.uri.scheme !== Schemas.untitled && isMatch(info.uri, pattern);
		});

		return tab?.uri;
	}

	async findTestFileForSourceFile(document: TextDocumentSnapshot, token: CancellationToken): Promise<URI | undefined> {

		if (document.isUntitled) {
			return undefined;
		}

		const basename = resources.basename(document.uri);
		const ext = resources.extname(document.uri);

		const testHint = testHintsByLanguage[document.languageId] ?? nullTestHint;

		const testNameCandidates: string[] = [];
		if (testHint.prefix) {
			testNameCandidates.push(testHint.prefix + basename);
		}
		if (testHint.suffixes) {
			for (const suffix of testHint.suffixes ?? []) {
				const testName = basename.replace(`${ext}`, `${suffix}${ext}`);
				testNameCandidates.push(testName);
			}
		}

		const pattern =
			testNameCandidates.length === 1
				? `**/${testNameCandidates[0]}`
				: `**/{${testNameCandidates.join(',')}}`;


		let result = this._findTabMatchingPattern(pattern);

		if (!result) {
			if (document.languageId === 'python') {
				result = await this._search.findFilesWithExcludes(pattern, '**/*.pyc', 1, token);
			} else {
				result = await this._search.findFilesWithDefaultExcludes(pattern, 1, token);
			}
		}

		return result;
	}

	async findAnyTestFileForSourceFile(document: TextDocumentSnapshot, token: CancellationToken): Promise<URI | undefined> {

		const testHint = testHintsByLanguage[document.languageId] ?? nullTestHint;

		const patterns: string[] = [];
		if (testHint.prefix) {
			patterns.push(`${testHint.prefix}*`);
		}
		if (testHint.suffixes) {
			const ext = resources.extname(document.uri);
			for (const suffix of testHint.suffixes ?? []) {
				patterns.push(`*${suffix}${ext}`);
			}
		}

		const pattern =
			patterns.length === 1
				? `**/${patterns[0]}`
				: `**/{${patterns.join(',')}}`;

		let result = this._findTabMatchingPattern(pattern);
		if (!result) {
			if (document.languageId === 'python') {
				result = await this._search.findFilesWithExcludes(pattern, '**/*.pyc', 1, token);
			} else {
				result = await this._search.findFilesWithDefaultExcludes(pattern, 1, token);
			}

		}
		return result;
	}

	async findFileForTestFile(document: TextDocumentSnapshot, token: CancellationToken): Promise<URI | undefined> {

		const testHint = testHintsByLanguage[document.languageId] ?? nullTestHint;

		const basename = resources.basename(document.uri);
		const parts: string[] = [];

		if (testHint.suffixes) {
			parts.splice(0, 0, ...testHint.suffixes);
		}
		if (testHint.prefix) {
			parts.splice(0, 0, testHint.prefix);
		}

		for (const part of parts) {
			const candidate = basename.replace(part, '');
			if (candidate !== basename) {
				const pattern = `**/${candidate}`;

				let result = this._findTabMatchingPattern(pattern);
				if (!result) {
					result = await this._search.findFilesWithDefaultExcludes(pattern, 1, token);
				}
				if (result) {
					return result;
				}
			}
		}

		return undefined;
	}
}

export function isTestFile(candidate: URI | TextDocumentSnapshot): boolean {

	let testHint: TestHint | undefined;
	if (candidate instanceof TextDocumentSnapshot) {
		testHint = testHintsByLanguage[candidate.languageId];
		candidate = candidate.uri;
	}

	const sourceFileName = resources.basename(candidate);
	const sourceFileExtension = resources.extname(candidate);
	testHint ??= testHintsBySuffix[sourceFileExtension.replace('.', '')];

	if (testHint) {

		if (testHint.suffixes) {
			const foundSuffixMatch = testHint.suffixes.some(suffix =>
				sourceFileName.endsWith(suffix + sourceFileExtension)
			);
			if (foundSuffixMatch) {
				return true;
			}
		}
		if (testHint.prefix && sourceFileName.startsWith(testHint.prefix)) {
			return true;
		}

	} else {
		const foundSuffixMatch = nullTestHint.suffixes.some(suffix => sourceFileName.endsWith(suffix + sourceFileExtension));
		if (foundSuffixMatch) {
			return true;
		}
		if (sourceFileName.startsWith(nullTestHint.prefix)) {
			return true;
		}
	}
	return false;
}

export function suggestTestFileBasename(document: TextDocumentSnapshot): string {
	const testHint = testHintsByLanguage[document.languageId] ?? nullTestHint;
	const basename = resources.basename(document.uri);

	if (testHint.prefix) {
		return testHint.prefix + basename;
	}

	const ext = resources.extname(document.uri);
	const suffix = testHint.suffixes && testHint.suffixes.length > 0
		? testHint.suffixes[0]
		: '.test';

	return basename.replace(`${ext}`, `${suffix}${ext}`);
}


export function suggestTestFileDir(document: TextDocumentSnapshot): URI {
	const srcFileLocation = resources.joinPath(document.uri, '..');
	if (document.languageId === 'java') {
		const srcFilePath = srcFileLocation.path;
		if (srcFilePath.includes('/src/main/')) {
			const testFilePath = srcFilePath.replace('/src/main/', '/src/test/');
			return srcFileLocation.with({ path: testFilePath });
		}
	}
	return srcFileLocation;
}

export function suggestUntitledTestFileLocation(document: TextDocumentSnapshot): URI {
	const newBasename = suggestTestFileBasename(document);
	const newLocation = suggestTestFileDir(document);
	const testFileUri = URI.joinPath(newLocation, newBasename).with({ scheme: Schemas.untitled });
	return testFileUri;
}
