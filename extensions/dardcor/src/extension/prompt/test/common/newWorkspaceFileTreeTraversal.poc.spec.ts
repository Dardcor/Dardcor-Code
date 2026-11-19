/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { convertFileTreeToChatResponseFileTree, listFilesInResponseFileTree } from '../../common/fileTreeParser';

suite('newWorkspace file tree traversal (PoC)', () => {
	const generatePreviewURI = (filename: string) => URI.file(`/preview/${filename}`);

	test('parser does not emit traversal paths from a malicious tree', () => {
		const fileStructure = `
project
├── package.json
├── ..
│   └── package.json
└── safe.txt
		`;

		const { chatResponseTree } = convertFileTreeToChatResponseFileTree(fileStructure, generatePreviewURI);
		const files = listFilesInResponseFileTree(chatResponseTree.value);

		for (const file of files) {
			expect(file.split('/')).not.toContain('..');
			expect(file.split('/')).not.toContain('.');
		}

		expect(files).toContain('project/package.json');
		expect(files).toContain('project/safe.txt');
	});

	test('parser rejects a malicious project root name', () => {
		const fileStructure = `
..
├── package.json
└── safe.txt
		`;

		expect(() => convertFileTreeToChatResponseFileTree(fileStructure, generatePreviewURI)).toThrow();
	});
});
