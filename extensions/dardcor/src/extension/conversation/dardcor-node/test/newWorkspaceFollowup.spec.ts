/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from 'vscode';
import { expect, suite, test } from 'vitest';
import { isUriContained, resolveProjectFileUri } from '../newWorkspaceFollowup';

suite('isUriContained', () => {
	const parent = Uri.file('/home/u/proj');

	test('accepts paths at or within the parent folder', () => {
		expect(isUriContained(parent, parent)).toBe(true);
		expect(isUriContained(parent, Uri.file('/home/u/proj/a.txt'))).toBe(true);
		expect(isUriContained(parent, Uri.file('/home/u/proj/sub/dir/a.txt'))).toBe(true);
	});

	test('rejects sibling paths with a shared name prefix', () => {
		expect(isUriContained(parent, Uri.file('/home/u/proj-evil/x'))).toBe(false);
		expect(isUriContained(parent, Uri.file('/home/u/projx'))).toBe(false);
	});

	test('rejects paths that escape the parent via traversal', () => {
		expect(isUriContained(parent, Uri.file('/home/u/package.json'))).toBe(false);
		expect(isUriContained(parent, Uri.file('/etc/passwd'))).toBe(false);
	});

	test('rejects URIs with mismatched scheme or authority', () => {
		const remoteParent = Uri.parse('vscode-remote://host/proj');
		const localChild = Uri.file('/proj/a.txt');
		expect(isUriContained(remoteParent, localChild)).toBe(false);

		const otherHost = Uri.parse('vscode-remote://other/proj/a.txt');
		expect(isUriContained(remoteParent, otherHost)).toBe(false);

		const sameHostChild = Uri.parse('vscode-remote://host/proj/a.txt');
		expect(isUriContained(remoteParent, sameHostChild)).toBe(true);
	});

	test('handles a parent path that already ends with a slash', () => {
		const withSlash = parent.with({ path: parent.path + '/' });
		expect(isUriContained(withSlash, Uri.file('/home/u/proj/a.txt'))).toBe(true);
		expect(isUriContained(withSlash, Uri.file('/home/u/proj-evil/x'))).toBe(false);
	});
});

suite('resolveProjectFileUri', () => {
	const workspaceUri = Uri.file('/home/u/parent/myrepo');

	test('handles a `/`-prefixed file path (GitHub repo-template flow)', () => {
		const fileUri = resolveProjectFileUri(workspaceUri, 'myrepo', '/src/index.ts');
		expect(fileUri.path).toBe('/home/u/parent/myrepo/src/index.ts');
	});

	test('handles a non-prefixed file path (dardcor new-workspace flow)', () => {
		const fileUri = resolveProjectFileUri(workspaceUri, 'myrepo', 'myrepo/src/index.ts');
		expect(fileUri.path).toBe('/home/u/parent/myrepo/src/index.ts');
	});

	test('preserves traversal segments so the containment check can reject them', () => {
		const fileUri = resolveProjectFileUri(workspaceUri, 'myrepo', 'myrepo/../package.json');
		expect(isUriContained(workspaceUri, fileUri)).toBe(false);
	});

	test('source preview URI built from the unmodified `file` resolves to the expected preview path', () => {
		const baseUri = Uri.parse('vscode-dardcor-github-workspace://req/myrepo');
		expect(Uri.joinPath(baseUri, '/src/index.ts').path).toBe('/myrepo/src/index.ts');
		const dardcorBase = Uri.parse('vscode-dardcor-workspace://req/myproject');
		expect(Uri.joinPath(dardcorBase, 'myproject/src/index.ts').path).toBe('/myproject/myproject/src/index.ts');
	});
});
