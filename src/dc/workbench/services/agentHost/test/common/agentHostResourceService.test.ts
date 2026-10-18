/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import {
	AgentHostAccessMode,
	AgentHostPermissionMode,
	AgentHostPermissionsSetting,
	AgentHostLocalFilePermissionsSettingId,
	AgentHostResourcePermissionError,
	LOCAL_AGENT_HOST_RESOURCE_IDENTITY,
} from '../../../../../platform/agentHost/common/agentHostResourceService.js';
import { AgentHostResourceService } from '../../common/agentHostResourceService.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';

const stubTextModelService = {} as unknown as ITextModelService;

class CapturingConfigurationService extends TestConfigurationService {
	override async updateValue(key: string, value: unknown, arg3?: ConfigurationTarget | unknown): Promise<void> {
		const target = typeof arg3 === 'number' ? arg3 as ConfigurationTarget : undefined;
		this.lastUpdate = { key, value, target };
		await this.setUserConfiguration(key, value);
	}

	lastUpdate: { key: string; value: unknown; target?: ConfigurationTarget } | undefined;
}

function createStubFileService(opts?: {
	realpathReturns?: (uri: URI) => URI | undefined;
}): IFileService {
	return {
		realpath: async (resource: URI) => opts?.realpathReturns ? opts.realpathReturns(resource) : resource,
	} as unknown as IFileService;
}

suite('AgentHostResourceService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(initial?: AgentHostPermissionsSetting, fileService = createStubFileService()): { service: AgentHostResourceService; config: CapturingConfigurationService } {
		const config = new CapturingConfigurationService();
		if (initial) {
			void config.setUserConfiguration(AgentHostLocalFilePermissionsSettingId, initial);
		}
		const service = disposables.add(new AgentHostResourceService(config, fileService, stubTextModelService, new NullLogService()));
		return { service, config };
	}

	test('check denies when no grant exists', async () => {
		const { service } = createService();
		assert.strictEqual(await service.check('host', URI.file('/etc/passwd'), AgentHostPermissionMode.Read), false);
		assert.strictEqual(await service.check('host', URI.file('/etc/passwd'), AgentHostPermissionMode.Write), false);
	});

	test('trusted local identity cannot be spoofed by a remote local address', async () => {
		const { service } = createService();
		const uri = URI.file('/etc/passwd');

		assert.deepStrictEqual({
			trustedLocal: await service.check(LOCAL_AGENT_HOST_RESOURCE_IDENTITY, uri, AgentHostPermissionMode.Write),
			remoteLocal: await service.check('local', uri, AgentHostPermissionMode.Read),
			normalizedRemoteLocal: await service.check('ws://local', uri, AgentHostPermissionMode.Read),
		}, {
			trustedLocal: true,
			remoteLocal: false,
			normalizedRemoteLocal: false,
		});
	});

	test('remote local address uses the normal permission request flow', async () => {
		const { service } = createService();
		const uri = URI.file('/etc/passwd');
		const promise = service.request('ws://local', { channel: 'ahp-root://', uri: uri.toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		const [pending] = service.allPending.get();

		assert.deepStrictEqual({
			address: pending.address,
			uri: pending.uri.toString(),
			mode: pending.mode,
		}, {
			address: 'local',
			uri: uri.toString(),
			mode: AgentHostPermissionMode.Read,
		});

		pending.deny();
		await assert.rejects(promise, (err: unknown) => err instanceof CancellationError);
	});

	test('implicit read grant covers descendants but not parent or sibling', async () => {
		const { service } = createService();
		disposables.add(service.grantImplicitRead('host', URI.file('/plugins/foo')));

		assert.strictEqual(await service.check('host', URI.file('/plugins/foo'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/plugins/foo/skill.md'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/plugins'), AgentHostPermissionMode.Read), false);
		assert.strictEqual(await service.check('host', URI.file('/plugins/bar'), AgentHostPermissionMode.Read), false);
	});

	test('implicit grant does not allow write', async () => {
		const { service } = createService();
		disposables.add(service.grantImplicitRead('host', URI.file('/plugins/foo')));
		assert.strictEqual(await service.check('host', URI.file('/plugins/foo'), AgentHostPermissionMode.Write), false);
	});

	test('persisted "r" allows read, denies write', async () => {
		const { service } = createService({
			'host': {
				[URI.file('/etc/foo').toString()]: AgentHostAccessMode.Read,
			},
		});
		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/foo/bar'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Write), false);
	});

	test('persisted "rw" allows read and write', async () => {
		const { service } = createService({
			'host': {
				[URI.file('/etc/foo').toString()]: AgentHostAccessMode.ReadWrite,
			},
		});
		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Write), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/foo/bar'), AgentHostPermissionMode.Write), true);
	});

	test('list projects readable grants through otherwise ungranted ancestors', async () => {
		const resolvedDirectories: string[] = [];
		const fileService = {
			realpath: async (resource: URI) => resource,
			resolve: async (resource: URI) => {
				resolvedDirectories.push(resource.path);
				const childrenByPath: Record<string, Array<{ name: string; isDirectory: boolean }>> = {
					'/': [
						{ name: 'foo', isDirectory: true },
						{ name: 'unrelated-root', isDirectory: true },
					],
					'/foo': [
						{ name: 'bar', isDirectory: true },
						{ name: 'qux', isDirectory: true },
						{ name: 'unrelated.txt', isDirectory: false },
					],
					'/foo/bar': [
						{ name: 'baz', isDirectory: false },
						{ name: 'unrelated.txt', isDirectory: false },
					],
					'/stale': [
						{ name: 'unrelated.txt', isDirectory: false },
					],
				};
				return {
					resource,
					isFile: false,
					isDirectory: true,
					isSymbolicLink: false,
					children: childrenByPath[resource.path] ?? [],
				};
			},
		} as unknown as IFileService;
		const { service } = createService({
			'host': {
				[URI.file('/foo/bar/baz').toString()]: AgentHostAccessMode.Read,
				[URI.file('/stale/missing.txt').toString()]: AgentHostAccessMode.Read,
			},
		}, fileService);
		disposables.add(service.grantImplicitRead('host', URI.file('/foo/qux')));

		assert.deepStrictEqual({
			root: await service.list('host', URI.file('/')),
			foo: await service.list('host', URI.file('/foo')),
			bar: await service.list('host', URI.file('/foo/bar')),
			stale: await service.list('host', URI.file('/stale')),
			resolvedDirectories,
		}, {
			root: { entries: [{ name: 'foo', type: 'directory' }] },
			foo: {
				entries: [
					{ name: 'bar', type: 'directory' },
					{ name: 'qux', type: 'directory' },
				],
			},
			bar: { entries: [{ name: 'baz', type: 'file' }] },
			stale: { entries: [] },
			resolvedDirectories: ['/', '/foo', '/foo/bar', '/stale'],
		});
	});

	test('persisted grants project through the original lexical symlink path', async () => {
		const fileService = {
			realpath: async (resource: URI) => resource.path.startsWith('/safe/link')
				? URI.file('/real' + resource.path.slice('/safe/link'.length))
				: resource,
			resolve: async (resource: URI) => ({
				resource,
				isFile: false,
				isDirectory: true,
				isSymbolicLink: false,
				children: resource.path === '/safe'
					? [{ name: 'link', isDirectory: true }]
					: [{ name: 'file.txt', isDirectory: false }],
			}),
		} as unknown as IFileService;
		const { service, config } = createService(undefined, fileService);
		const lexicalUri = URI.file('/safe/link/file.txt');
		const canonicalUri = URI.file('/real/file.txt');
		const promise = service.request('host', { channel: 'ahp-root://', uri: lexicalUri.toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		const persisted = config.lastUpdate?.value as AgentHostPermissionsSetting;
		assert.deepStrictEqual(persisted, {
			'host': {
				[canonicalUri.toString()]: {
					mode: AgentHostAccessMode.Read,
					lexicalUri: lexicalUri.toString(),
				},
			},
		});

		const { service: restoredService } = createService(persisted, fileService);
		assert.deepStrictEqual({
			safe: await restoredService.list('host', URI.file('/safe')),
			link: await restoredService.list('host', URI.file('/safe/link')),
			read: await restoredService.check('host', lexicalUri, AgentHostPermissionMode.Read),
		}, {
			safe: { entries: [{ name: 'link', type: 'directory' }] },
			link: { entries: [{ name: 'file.txt', type: 'file' }] },
			read: true,
		});
	});

	test('list does not project grants from another host', async () => {
		const { service } = createService({
			'host-a': {
				[URI.file('/foo/bar').toString()]: AgentHostAccessMode.Read,
			},
		});

		await assert.rejects(
			service.list('host-b', URI.file('/')),
			(err: unknown) => err instanceof AgentHostResourcePermissionError,
		);
	});

	test('list returns the full contents of a granted directory', async () => {
		const fileService = {
			realpath: async (resource: URI) => resource,
			resolve: async (resource: URI) => ({
				resource,
				isFile: false,
				isDirectory: true,
				isSymbolicLink: false,
				children: [
					{ name: 'visible.txt', isDirectory: false },
					{ name: 'nested', isDirectory: true },
				],
			}),
		} as unknown as IFileService;
		const { service } = createService({
			'host': {
				[URI.file('/foo').toString()]: AgentHostAccessMode.Read,
			},
		}, fileService);

		assert.deepStrictEqual(await service.list('host', URI.file('/foo')), {
			entries: [
				{ name: 'visible.txt', type: 'file' },
				{ name: 'nested', type: 'directory' },
			],
		});
	});

	test('check canonicalizes via realpath so symlink to outside the grant is denied', async () => {
		const fileService = createStubFileService({
			realpathReturns: uri => uri.path.startsWith('/safe/sym')
				? URI.file('/sensitive' + uri.path.slice('/safe/sym'.length))
				: uri,
		});
		const { service } = createService(undefined, fileService);
		disposables.add(service.grantImplicitRead('host', URI.file('/safe')));

		assert.strictEqual(await service.check('host', URI.file('/safe/foo'), AgentHostPermissionMode.Read), true);

		assert.strictEqual(await service.check('host', URI.file('/safe/sym/leak'), AgentHostPermissionMode.Read), false);
	});

	test('implicit grant for a symlinked directory still covers descendants resolved through the symlink', async () => {
		const fileService = createStubFileService({
			realpathReturns: uri => uri.path.startsWith('/safe/sym')
				? URI.file('/real' + uri.path.slice('/safe/sym'.length))
				: uri,
		});
		const { service } = createService(undefined, fileService);
		disposables.add(service.grantImplicitRead('host', URI.file('/safe/sym')));
		assert.strictEqual(await service.check('host', URI.file('/safe/sym/leaf'), AgentHostPermissionMode.Read), true);
	});

	test('check rejects path traversal via .. segments', async () => {
		const { service } = createService();
		disposables.add(service.grantImplicitRead('host', URI.file('/safe')));

		assert.strictEqual(await service.check('host', URI.file('/safe/../etc/passwd'), AgentHostPermissionMode.Read), false);
	});

	test('check canonicalizes nonexistent paths via the parent realpath', async () => {
		const fileService = createStubFileService({
			realpathReturns: uri => {
				if (uri.path === '/safe/sym/new.txt') {
					return undefined;
				}
				if (uri.path === '/safe/sym') {
					return URI.file('/real');
				}
				return uri;
			},
		});
		const { service } = createService(undefined, fileService);
		disposables.add(service.grantImplicitRead('host', URI.file('/real')));

		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(
			await service.check('host', URI.file('/safe/sym/new.txt'), AgentHostPermissionMode.Read),
			true,
			'nonexistent file under a symlinked parent should canonicalize to /real/new.txt',
		);
	});

	test('check walks ancestors so nested missing paths through a symlink are denied', async () => {
		const fileService = createStubFileService({
			realpathReturns: uri => {
				if (
					uri.path === '/safe/sym/a/b.txt'
					|| uri.path === '/safe/sym/a'
					|| uri.path === '/safe/sym/new.txt'
					|| uri.path === '/safe/new/dir/file.txt'
					|| uri.path === '/safe/new/dir'
					|| uri.path === '/safe/new'
				) {
					return undefined;
				}
				if (uri.path === '/safe/sym') {
					return URI.file('/outside');
				}
				return uri;
			},
		});
		const { service } = createService({
			'host': {
				[URI.file('/safe').toString()]: AgentHostAccessMode.ReadWrite,
			},
		}, fileService);

		assert.deepStrictEqual({
			nestedMissingThroughSymlink: await service.check('host', URI.file('/safe/sym/a/b.txt'), AgentHostPermissionMode.Write),
			oneLevelMissingThroughSymlink: await service.check('host', URI.file('/safe/sym/new.txt'), AgentHostPermissionMode.Write),
			nestedMissingInsideGrant: await service.check('host', URI.file('/safe/new/dir/file.txt'), AgentHostPermissionMode.Write),
		}, {
			nestedMissingThroughSymlink: false,
			oneLevelMissingThroughSymlink: false,
			nestedMissingInsideGrant: true,
		});
	});

	test('request resolves immediately when already granted', async () => {
		const { service } = createService();
		disposables.add(service.grantImplicitRead('host', URI.file('/plugins/foo')));
		await service.request('host', { channel: 'ahp-root://', uri: URI.file('/plugins/foo/x.md').toString(), read: true });
		assert.strictEqual(service.allPending.get().length, 0);
	});

	test('allow grants in-memory until connection closes', async () => {
		const { service, config } = createService();
		const uri = URI.file('/etc/foo');
		const promise = service.request('host', { channel: 'ahp-root://', uri: uri.toString(), read: true });

		await new Promise(resolve => setTimeout(resolve, 0));
		const pending = service.allPending.get();
		assert.strictEqual(pending.length, 1);

		pending[0].allow();
		await promise;

		assert.strictEqual(await service.check('host', uri, AgentHostPermissionMode.Read), true);
		assert.strictEqual(config.lastUpdate, undefined);

		service.connectionClosed('host');
		assert.strictEqual(await service.check('host', uri, AgentHostPermissionMode.Read), false);
	});

	test('allow for write also covers read on the same URI', async () => {
		const { service } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), write: true });

		await new Promise(resolve => setTimeout(resolve, 0));
		const pending = service.allPending.get();
		assert.strictEqual(pending[0].mode, AgentHostPermissionMode.Write);
		pending[0].allow();
		await promise;

		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Write), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/bar'), AgentHostPermissionMode.Read), false);
	});

	test('allow for read does not grant write', async () => {
		const { service } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });

		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allow();
		await promise;

		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host', URI.file('/etc/foo'), AgentHostPermissionMode.Write), false);
	});

	test('request rejects with CancellationError on deny', async () => {
		const { service } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].deny();
		await assert.rejects(promise, (err: unknown) => err instanceof CancellationError);
	});

	test('allowAlways persists the grant', async () => {
		const { service, config } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		assert.strictEqual(config.lastUpdate?.key, AgentHostLocalFilePermissionsSettingId);
		const value = config.lastUpdate.value as AgentHostPermissionsSetting;
		assert.strictEqual(value['host'][URI.file('/etc/foo').toString()], AgentHostAccessMode.Read);
	});

	test('allowAlways covers immediate retry without waiting for the settings write', async () => {
		const config = new (class extends CapturingConfigurationService {
			override async updateValue(key: string, value: unknown, target?: unknown): Promise<void> {
				await new Promise(resolve => setTimeout(resolve, 50));
				await super.updateValue(key, value, target as ConfigurationTarget);
			}
		})();
		const service = disposables.add(new AgentHostResourceService(config, createStubFileService(), stubTextModelService, new NullLogService()));

		const uri = URI.file('/etc/foo');
		const promise = service.request('host', { channel: 'ahp-root://', uri: uri.toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		assert.strictEqual(await service.check('host', uri, AgentHostPermissionMode.Read), true);
	});

	test('allowAlways for write persists rw', async () => {
		const { service, config } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), write: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		const value = config.lastUpdate?.value as AgentHostPermissionsSetting;
		assert.strictEqual(value['host'][URI.file('/etc/foo').toString()], AgentHostAccessMode.ReadWrite);
	});

	test('allowAlways skips persistence when covered by parent grant', async () => {
		const { service, config } = createService({
			'host': {
				[URI.file('/etc').toString()]: AgentHostAccessMode.ReadWrite,
			},
		});
		await service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		assert.strictEqual(config.lastUpdate, undefined);
	});

	test('concurrent identical requests share one pending entry', async () => {
		const { service } = createService();
		const a = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		const b = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });

		await new Promise(resolve => setTimeout(resolve, 0));
		assert.strictEqual(service.allPending.get().length, 1);
		service.allPending.get()[0].allow();
		await Promise.all([a, b]);
	});

	test('write request that already has read grant still prompts for write', async () => {
		const { service } = createService({
			'host': {
				[URI.file('/etc/foo').toString()]: AgentHostAccessMode.Read,
			},
		});
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), write: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.strictEqual(service.allPending.get().length, 1);
		assert.strictEqual(service.allPending.get()[0].mode, AgentHostPermissionMode.Write);
		service.allPending.get()[0].allow();
		await promise;
	});

	test('connectionClosed rejects pending and clears the queue', async () => {
		const { service } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.connectionClosed('host');
		await assert.rejects(promise, (err: unknown) => err instanceof CancellationError);
		assert.strictEqual(service.allPending.get().length, 0);
	});

	test('connectionClosed drops implicit grants', async () => {
		const { service } = createService();
		disposables.add(service.grantImplicitRead('host', URI.file('/plugins/foo')));
		assert.strictEqual(await service.check('host', URI.file('/plugins/foo/x'), AgentHostPermissionMode.Read), true);
		service.connectionClosed('host');
		assert.strictEqual(await service.check('host', URI.file('/plugins/foo/x'), AgentHostPermissionMode.Read), false);
	});

	test('address normalization strips ws:// prefix', async () => {
		const { service } = createService({
			'host:1234': {
				[URI.file('/etc/foo').toString()]: AgentHostAccessMode.Read,
			},
		});
		assert.strictEqual(await service.check('ws://host:1234', URI.file('/etc/foo'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(await service.check('host:1234', URI.file('/etc/foo'), AgentHostPermissionMode.Read), true);
	});

	test('findPending returns the pending request by id', async () => {
		const { service } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		const [pending] = service.allPending.get();
		assert.strictEqual(service.findPending(pending.id), pending);
		pending.allow();
		await promise;
	});


	test('grants for one host do not leak into another host', async () => {
		const { service } = createService({
			'host-a': {
				[URI.file('/etc/foo').toString()]: AgentHostAccessMode.ReadWrite,
			},
		});
		disposables.add(service.grantImplicitRead('host-a', URI.file('/plugins/p')));

		assert.strictEqual(await service.check('host-b', URI.file('/etc/foo'), AgentHostPermissionMode.Read), false);
		assert.strictEqual(await service.check('host-b', URI.file('/plugins/p'), AgentHostPermissionMode.Read), false);
		assert.strictEqual(await service.check('host-a', URI.file('/etc/foo'), AgentHostPermissionMode.Write), true);
	});

	test('connectionClosed only affects the named address', async () => {
		const { service } = createService();
		disposables.add(service.grantImplicitRead('host-a', URI.file('/plugins/a')));
		disposables.add(service.grantImplicitRead('host-b', URI.file('/plugins/b')));

		const pendingA = service.request('host-a', { channel: 'ahp-root://', uri: URI.file('/etc/a').toString(), read: true });
		const pendingB = service.request('host-b', { channel: 'ahp-root://', uri: URI.file('/etc/b').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));

		service.connectionClosed('host-a');

		await assert.rejects(pendingA, (err: unknown) => err instanceof CancellationError);
		assert.strictEqual(await service.check('host-b', URI.file('/plugins/b'), AgentHostPermissionMode.Read), true);
		assert.strictEqual(service.allPending.get().length, 1);

		service.allPending.get()[0].allow();
		await pendingB;
	});


	test('pendingFor returns only this host\'s requests, with normalized address', async () => {
		const { service } = createService();
		const a = service.request('host-a', { channel: 'ahp-root://', uri: URI.file('/etc/a').toString(), read: true });
		const b = service.request('ws://host-b', { channel: 'ahp-root://', uri: URI.file('/etc/b').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(service.pendingFor('host-a').get().length, 1);
		assert.strictEqual(service.pendingFor('host-b').get().length, 1);
		assert.strictEqual(service.pendingFor('host-b').get()[0].uri.toString(), URI.file('/etc/b').toString());
		assert.strictEqual(service.pendingFor('ws://host-b').get().length, 1);

		service.allPending.get().forEach(p => p.allow());
		await Promise.all([a, b]);
	});


	test('request with both read and write prompts sequentially', async () => {
		const { service } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true, write: true });
		await new Promise(resolve => setTimeout(resolve, 0));

		let pending = service.allPending.get();
		assert.strictEqual(pending.length, 1);
		assert.strictEqual(pending[0].mode, AgentHostPermissionMode.Read);
		pending[0].allow();
		await new Promise(resolve => setTimeout(resolve, 0));

		pending = service.allPending.get();
		assert.strictEqual(pending.length, 1);
		assert.strictEqual(pending[0].mode, AgentHostPermissionMode.Write);
		pending[0].allow();
		await promise;
	});


	test('grantImplicitRead asynchronously upgrades to realpath', async () => {
		const fileService = createStubFileService({
			realpathReturns: uri => uri.path === '/home/me/plugin-link' ? URI.file('/real/plugin') : uri,
		});
		const { service } = createService(undefined, fileService);
		disposables.add(service.grantImplicitRead('host', URI.file('/home/me/plugin-link')));

		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(await service.check('host', URI.file('/real/plugin/skill.md'), AgentHostPermissionMode.Read), true);
	});


	test('allowAlways defaults to APPLICATION scope when no value is configured anywhere', async () => {
		const { service, config } = createService();
		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		assert.strictEqual(config.lastUpdate?.target, ConfigurationTarget.APPLICATION);
	});

	test('allowAlways merges with existing APPLICATION-scoped grants instead of overwriting them', async () => {
		const config = new CapturingConfigurationService();
		const existing: AgentHostPermissionsSetting = {
			'other-host': { [URI.file('/etc/preexisting').toString()]: AgentHostAccessMode.ReadWrite },
		};
		const originalInspect = config.inspect.bind(config);
		(config as { inspect: (key: string) => unknown }).inspect = (key: string) => {
			if (key === AgentHostLocalFilePermissionsSettingId) {
				return {
					value: existing,
					defaultValue: {},
					applicationValue: existing,
					overrideIdentifiers: [],
				};
			}
			return originalInspect(key);
		};
		const service = disposables.add(new AgentHostResourceService(config, createStubFileService(), stubTextModelService, new NullLogService()));

		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		assert.strictEqual(config.lastUpdate?.target, ConfigurationTarget.APPLICATION);
		const written = config.lastUpdate.value as AgentHostPermissionsSetting;
		assert.deepStrictEqual(written, {
			'other-host': { [URI.file('/etc/preexisting').toString()]: AgentHostAccessMode.ReadWrite },
			'host': { [URI.file('/etc/foo').toString()]: AgentHostAccessMode.Read },
		});
	});

	test('allowAlways persists into USER_LOCAL when a pre-existing value is in USER_LOCAL', async () => {
		const config = new CapturingConfigurationService();
		const originalInspect = config.inspect.bind(config);
		(config as { inspect: (key: string) => unknown }).inspect = (key: string) => {
			if (key === AgentHostLocalFilePermissionsSettingId) {
				return {
					value: {},
					defaultValue: {},
					userLocalValue: {},
					overrideIdentifiers: [],
				};
			}
			return originalInspect(key);
		};
		const service = disposables.add(new AgentHostResourceService(config, createStubFileService(), stubTextModelService, new NullLogService()));

		const promise = service.request('host', { channel: 'ahp-root://', uri: URI.file('/etc/foo').toString(), read: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		service.allPending.get()[0].allowAlways();
		await promise;

		assert.strictEqual(config.lastUpdate?.target, ConfigurationTarget.USER_LOCAL);
	});

	test('workspace-configured grants do not authorize filesystem access', async () => {
		const workspaceGrants: AgentHostPermissionsSetting = {
			'192.168.48.1:9492': {
				[URI.file('/Users').toString()]: AgentHostAccessMode.Read,
			},
		};
		const config = new CapturingConfigurationService();
		await config.setUserConfiguration(AgentHostLocalFilePermissionsSettingId, workspaceGrants);
		const originalInspect = config.inspect.bind(config);
		(config as { inspect: (key: string) => unknown }).inspect = (key: string) => {
			if (key === AgentHostLocalFilePermissionsSettingId) {
				return {
					value: workspaceGrants,
					defaultValue: {},
					workspaceValue: workspaceGrants,
					workspaceFolderValue: workspaceGrants,
					overrideIdentifiers: [],
				};
			}
			return originalInspect(key);
		};
		const service = disposables.add(new AgentHostResourceService(config, createStubFileService(), stubTextModelService, new NullLogService()));

		assert.strictEqual(await service.check('192.168.48.1:9492', URI.file('/Users/victim/secret.txt'), AgentHostPermissionMode.Read), false);
		await assert.rejects(
			service.read('192.168.48.1:9492', URI.file('/Users/victim/secret.txt')),
			(err: unknown) => err instanceof AgentHostResourcePermissionError,
		);
		await assert.rejects(
			service.list('192.168.48.1:9492', URI.file('/Users')),
			(err: unknown) => err instanceof AgentHostResourcePermissionError,
		);
	});


	test('persisted entries with malformed URI keys or unknown modes are ignored', async () => {
		const { service } = createService({
			'host': {
				'::not a uri::': AgentHostAccessMode.ReadWrite,
				[URI.file('/etc/garbage').toString()]: 'unknown' as unknown as AgentHostAccessMode,
				[URI.file('/etc/good').toString()]: AgentHostAccessMode.Read,
			},
		});
		assert.strictEqual(await service.check('host', URI.file('/etc/garbage'), AgentHostPermissionMode.Read), false);
		assert.strictEqual(await service.check('host', URI.file('/etc/good'), AgentHostPermissionMode.Read), true);
	});
});
