/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { window, commands, ViewColumn, workspace } from 'vscode';
import { assertNoRpc, closeAllEditors } from '../utils';

(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite)('vscode API - browser', () => {

	teardown(async function () {
		assertNoRpc();
		await closeAllEditors();
	});


	test('browserTabs is an array', () => {
		assert.ok(Array.isArray(window.browserTabs));
	});

	test('activeBrowserTab is undefined when no browser tab is open', () => {
		assert.strictEqual(window.activeBrowserTab, undefined);
	});



	test('openBrowserTab returns a BrowserTab with url, title, and icon', async () => {
		const tab = await window.openBrowserTab('about:blank');

		assert.ok(tab);
		assert.strictEqual(tab.url, 'about:blank');
		assert.ok(tab.title);
		assert.ok(tab.icon);
	});

	test('openBrowserTab adds tab to browserTabs', async () => {
		const before = window.browserTabs.length;
		await window.openBrowserTab('about:blank');
		assert.strictEqual(window.browserTabs.length, before + 1);
	});

	test('openBrowserTab with viewColumn.Beside', async () => {
		const tab = await window.openBrowserTab('about:blank', { viewColumn: ViewColumn.Beside });
		assert.ok(tab);
		assert.strictEqual(tab.url, 'about:blank');
	});

	test('openBrowserTab with preserveFocus', async () => {
		const tab = await window.openBrowserTab('about:blank', { preserveFocus: true });
		assert.ok(tab);
	});

	test('openBrowserTab with background', async () => {
		const tab = await window.openBrowserTab('about:blank', { background: true });
		assert.ok(tab);
	});



	test('BrowserTab.close removes the tab from browserTabs', async () => {
		const tab = await window.openBrowserTab('about:blank');
		const countBefore = window.browserTabs.length;

		await tab.close();

		assert.strictEqual(window.browserTabs.length, countBefore - 1);
	});

	test('Closing via workbench.action.closeActiveEditor removes tab from browserTabs', async () => {
		const tab = await window.openBrowserTab('about:blank');
		assert.ok(window.browserTabs.includes(tab));

		const closed = new Promise<vscode.BrowserTab>(resolve => {
			const disposable = window.onDidCloseBrowserTab(t => {
				disposable.dispose();
				resolve(t);
			});
		});

		await commands.executeCommand('workbench.action.closeActiveEditor');
		const firedTab = await closed;
		assert.ok(firedTab);
		assert.ok(!window.browserTabs.includes(tab));
	});

	test('Can move a browser tab to a new group and close it successfully', async () => {
		const tab = await window.openBrowserTab('about:blank');
		assert.ok(window.browserTabs.includes(tab));

		await commands.executeCommand('workbench.action.moveEditorToNextGroup');

		await tab.close();
		assert.ok(!window.browserTabs.includes(tab));
	});



	test('onDidOpenBrowserTab fires when a tab is opened', async () => {
		const opened = new Promise<vscode.BrowserTab>(resolve => {
			const disposable = window.onDidOpenBrowserTab(tab => {
				disposable.dispose();
				resolve(tab);
			});
		});

		const tab = await window.openBrowserTab('about:blank');
		const firedTab = await opened;
		assert.strictEqual(firedTab.url, tab.url);
	});



	test('onDidCloseBrowserTab fires when a tab is closed', async () => {
		const tab = await window.openBrowserTab('about:blank');

		const closed = new Promise<vscode.BrowserTab>(resolve => {
			const disposable = window.onDidCloseBrowserTab(t => {
				disposable.dispose();
				resolve(t);
			});
		});

		await tab.close();
		const firedTab = await closed;
		assert.ok(firedTab);
	});



	test('activeBrowserTab is set after opening a tab', async () => {
		await window.openBrowserTab('about:blank');
		assert.ok(window.activeBrowserTab);
	});

	test('onDidChangeActiveBrowserTab fires when active tab changes', async () => {
		const changed = new Promise<vscode.BrowserTab | undefined>(resolve => {
			const disposable = window.onDidChangeActiveBrowserTab(tab => {
				disposable.dispose();
				resolve(tab);
			});
		});

		await window.openBrowserTab('about:blank');
		const activeTab = await changed;
		assert.ok(activeTab);
	});



	test('startCDPSession returns a session with expected API', async () => {
		const tab = await window.openBrowserTab('about:blank');
		const session = await tab.startCDPSession();

		assert.ok(session);
		assert.ok(session.onDidReceiveMessage);
		assert.ok(session.onDidClose);
		assert.ok(typeof session.sendMessage === 'function');
		assert.ok(typeof session.close === 'function');

		await session.close();
	});

	test('CDP sendMessage and onDidReceiveMessage round-trip', async () => {
		const tab = await window.openBrowserTab('about:blank');
		const session = await tab.startCDPSession();

		const response = new Promise<any>(resolve => {
			const disposable = session.onDidReceiveMessage((msg: any) => {
				if (msg.id === 1) {
					disposable.dispose();
					resolve(msg);
				}
			});
		});

		await session.sendMessage({ id: 1, method: 'Target.getTargets' });
		const msg = await response;
		assert.ok(msg.result);
		const targets: any[] = msg.result.targetInfos;
		assert.equal(targets.length, 1);
		assert.equal(targets[0].url, 'about:blank');

		await session.close();
	});

	test('CDP session.close fires onDidClose', async () => {
		const tab = await window.openBrowserTab('about:blank');
		const session = await tab.startCDPSession();

		const closed = new Promise<void>(resolve => {
			const disposable = session.onDidClose(() => {
				disposable.dispose();
				resolve();
			});
		});

		await session.close();
		await closed;
	});



	(vscode.env.remoteName ? suite.skip : suite)('trusted file:// loading', () => {
		const HARNESS_NAME = 'trust-harness.html';
		const HARNESS_CONTENT = `<!DOCTYPE html>
<html>
<head><title>idle</title></head>
<body>
<script>
(async function () {
	// Use the URL fragment rather than the query string — Chromium's
	// built-in \`file://\` loader rejects URLs with a \`?query\`, but
	// fragments are stripped before the file is read.
	const params = new URLSearchParams(location.hash.slice(1));
	const target = params.get('url');
	if (!target) {
		document.title = 'no-url';
		return;
	}
	try {
		const res = await fetch(target);
		document.title = 'status:' + res.status;
	} catch (err) {
		document.title = 'error:' + (err && err.message || err);
	}
})();
</script>
</body>
</html>`;

		let harnessUri: vscode.Uri | undefined;

		suiteSetup(async () => {
			const folders = workspace.workspaceFolders;
			assert.ok(folders && folders.length > 0, 'expected at least one workspace folder');
			harnessUri = vscode.Uri.joinPath(folders[0].uri, HARNESS_NAME);
			await fs.promises.writeFile(harnessUri.fsPath, HARNESS_CONTENT);
		});

		suiteTeardown(async () => {
			if (harnessUri) {
				await fs.promises.rm(harnessUri.fsPath, { force: true });
				harnessUri = undefined;
			}
		});

		async function fetchFromTrustedHarness(target: string): Promise<string> {
			assert.ok(harnessUri, 'harness must be initialized');
			const url = `${harnessUri.toString()}#url=${encodeURIComponent(target)}`;
			const tab = await window.openBrowserTab(url);

			const deadline = Date.now() + 15_000;
			while (Date.now() < deadline) {
				if (tab.title.startsWith('status:') || tab.title.startsWith('error:')) {
					return tab.title;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			throw new Error(`Timed out waiting for trust-harness title to update (target=${target}, last title=${tab.title})`);
		}

		test.skip('file:// inside a trusted workspace folder loads', async function () {
			this.timeout(30_000);

			const folders = workspace.workspaceFolders!;
			const trustedTarget = vscode.Uri.joinPath(folders[0].uri, 'index.html').toString();

			const title = await fetchFromTrustedHarness(trustedTarget);
			assert.ok(title.startsWith('status:200'), `Expected status 200 for trusted file, got: ${title}`);
		});

		test.skip('file:// outside any trusted root is blocked with 403', async function () {
			this.timeout(30_000);

			const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-browser-trust-'));
			const untrustedFile = path.join(tempDir, 'untrusted.html');
			await fs.promises.writeFile(untrustedFile, '<!doctype html><body>should not be reachable</body>');

			try {
				const title = await fetchFromTrustedHarness(vscode.Uri.file(untrustedFile).toString());
				assert.ok(title.startsWith('status:403'), `Expected status 403 for untrusted file, got: ${title}`);
			} finally {
				await fs.promises.rm(tempDir, { recursive: true, force: true });
			}
		});
	});

});
