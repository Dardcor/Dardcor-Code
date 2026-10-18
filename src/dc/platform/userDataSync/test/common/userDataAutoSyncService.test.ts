/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { joinPath } from '../../../../base/common/resources.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEnvironmentService } from '../../../environment/common/environment.js';
import { IFileService } from '../../../files/common/files.js';
import { IUserDataProfilesService } from '../../../userDataProfile/common/userDataProfile.js';
import { UserDataAutoSyncService } from '../../common/userDataAutoSyncService.js';
import { IUserDataSyncService, SyncResource, UserDataAutoSyncError, UserDataSyncErrorCode, UserDataSyncStoreError } from '../../common/userDataSync.js';
import { IUserDataSyncMachinesService } from '../../common/userDataSyncMachines.js';
import { UserDataSyncClient, UserDataSyncTestServer } from './userDataSyncClient.js';

class TestUserDataAutoSyncService extends UserDataAutoSyncService {
	protected override startAutoSync(): boolean { return false; }
	protected override getSyncTriggerDelayTime(): number { return 50; }

	sync(): Promise<void> {
		return this.triggerSync(['sync']);
	}
}

suite('UserDataAutoSyncService', () => {

	const disposableStore = ensureNoDisposablesAreLeakedInTestSuite();

	test('test auto sync with sync resource change triggers sync', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();

			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();
			target.reset();

			const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.triggerSync([SyncResource.Settings]);

			const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

			assert.deepStrictEqual(actual, [{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }]);
		});
	});

	test('test auto sync with sync resource change triggers sync for every change', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();

			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();
			target.reset();

			const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			for (let counter = 0; counter < 2; counter++) {
				await testObject.triggerSync([SyncResource.Settings]);
			}

			const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

			assert.deepStrictEqual(actual, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } }
			]);
		});
	});

	test('test auto sync with non sync resource change triggers sync', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();

			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();
			target.reset();

			const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.triggerSync(['windowFocus']);

			const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

			assert.deepStrictEqual(actual, [{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }]);
		});
	});

	test('test auto sync with non sync resource change does not trigger continuous syncs', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();

			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();
			target.reset();

			const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			for (let counter = 0; counter < 2; counter++) {
				await testObject.triggerSync(['windowFocus'], { skipIfSyncedRecently: true });
			}

			const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

			assert.deepStrictEqual(actual, [{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }]);
		});
	});

	test('test first auto sync requests', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.sync();

			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
				{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: {} },
				{ type: 'POST', url: `${target.url}/v1/resource/settings`, headers: { 'If-Match': '0' } },
				{ type: 'POST', url: `${target.url}/v1/resource/keybindings`, headers: { 'If-Match': '0' } },
				{ type: 'POST', url: `${target.url}/v1/resource/snippets`, headers: { 'If-Match': '0' } },
				{ type: 'POST', url: `${target.url}/v1/resource/tasks`, headers: { 'If-Match': '0' } },
				{ type: 'POST', url: `${target.url}/v1/resource/globalState`, headers: { 'If-Match': '0' } },
				{ type: 'POST', url: `${target.url}/v1/resource/prompts`, headers: { 'If-Match': '0' } },
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
				{ type: 'POST', url: `${target.url}/v1/resource/machines`, headers: { 'If-Match': '0' } }
			]);
		});
	});

	test('test further auto sync requests without changes', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.sync();
			target.reset();

			await testObject.sync();

			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } }
			]);
		});
	});

	test('test further auto sync requests with changes', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.sync();
			target.reset();

			const fileService = client.instantiationService.get(IFileService);
			const environmentService = client.instantiationService.get(IEnvironmentService);
			const userDataProfilesService = client.instantiationService.get(IUserDataProfilesService);
			await fileService.writeFile(userDataProfilesService.defaultProfile.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
			await fileService.writeFile(userDataProfilesService.defaultProfile.keybindingsResource, VSBuffer.fromString(JSON.stringify([{ 'command': 'abcd', 'key': 'cmd+c' }])));
			await fileService.writeFile(joinPath(userDataProfilesService.defaultProfile.snippetsHome, 'html.json'), VSBuffer.fromString(`{}`));
			await fileService.writeFile(joinPath(userDataProfilesService.defaultProfile.promptsHome, 'h1.prompt.md'), VSBuffer.fromString(' '));
			await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'de' })));
			await testObject.sync();

			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } },
				{ type: 'POST', url: `${target.url}/v1/resource/settings`, headers: { 'If-Match': '1' } },
				{ type: 'POST', url: `${target.url}/v1/resource/keybindings`, headers: { 'If-Match': '1' } },
				{ type: 'POST', url: `${target.url}/v1/resource/snippets`, headers: { 'If-Match': '1' } },
				{ type: 'POST', url: `${target.url}/v1/resource/globalState`, headers: { 'If-Match': '1' } },
				{ type: 'POST', url: `${target.url}/v1/resource/prompts`, headers: { 'If-Match': '1' } },
			]);
		});
	});

	test('test auto sync send execution id header', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();
			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.sync();
			target.reset();

			await testObject.sync();

			for (const request of target.requestsWithAllHeaders) {
				const hasExecutionIdHeader = request.headers && request.headers['X-Execution-Id'] && request.headers['X-Execution-Id'].length > 0;
				if (request.url.startsWith(`${target.url}/v1/resource/machines`)) {
					assert.ok(!hasExecutionIdHeader, `Should not have execution header: ${request.url}`);
				} else {
					assert.ok(hasExecutionIdHeader, `Should have execution header: ${request.url}`);
				}
			}
		});
	});

	test('test delete on one client throws turned off error on other client while syncing', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();

			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();
			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
			await testObject.sync();

			await client.instantiationService.get(IUserDataSyncService).reset();

			target.reset();

			const errorPromise = Event.toPromise(testObject.onError);
			await testObject.sync();

			const e = await errorPromise;
			assert.ok(e instanceof UserDataAutoSyncError);
			assert.deepStrictEqual((<UserDataAutoSyncError>e).code, UserDataSyncErrorCode.TurnedOff);
			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } },
				{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: { 'If-None-Match': '1' } },
			]);
		});
	});

	test('test disabling the machine turns off sync', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
			await testObject.sync();

			const userDataSyncMachinesService = testClient.instantiationService.get(IUserDataSyncMachinesService);
			const machines = await userDataSyncMachinesService.getMachines();
			const currentMachine = machines.find(m => m.isCurrent)!;
			await userDataSyncMachinesService.setEnablements([[currentMachine.id, false]]);

			target.reset();

			const errorPromise = Event.toPromise(testObject.onError);
			await testObject.sync();

			const e = await errorPromise;
			assert.ok(e instanceof UserDataAutoSyncError);
			assert.deepStrictEqual((<UserDataAutoSyncError>e).code, UserDataSyncErrorCode.TurnedOff);
			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } },
				{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: { 'If-None-Match': '2' } },
				{ type: 'POST', url: `${target.url}/v1/resource/machines`, headers: { 'If-Match': '2' } },
			]);
		});
	});

	test('test removing the machine adds machine back', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
			await testObject.sync();

			await testClient.instantiationService.get(IUserDataSyncMachinesService).removeCurrentMachine();

			target.reset();

			await testObject.sync();
			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } },
				{ type: 'POST', url: `${target.url}/v1/resource/machines`, headers: { 'If-Match': '2' } },
			]);
		});
	});

	test('test creating new session from one client throws session expired error on another client while syncing', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer();

			const client = disposableStore.add(new UserDataSyncClient(target));
			await client.setUp();
			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
			await testObject.sync();

			await client.instantiationService.get(IUserDataSyncService).reset();

			await (await client.instantiationService.get(IUserDataSyncService).createSyncTask(null)).run();

			target.reset();

			const errorPromise = Event.toPromise(testObject.onError);
			await testObject.sync();

			const e = await errorPromise;
			assert.ok(e instanceof UserDataAutoSyncError);
			assert.deepStrictEqual((<UserDataAutoSyncError>e).code, UserDataSyncErrorCode.SessionExpired);
			assert.deepStrictEqual(target.requests, [
				{ type: 'GET', url: `${target.url}/v1/manifest`, headers: { 'If-None-Match': '1' } },
				{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: { 'If-None-Match': '1' } },
			]);
		});
	});

	test('test rate limit on server', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer(5);

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

			const errorPromise = Event.toPromise(testObject.onError);
			while (target.requests.length < 5) {
				await testObject.sync();
			}

			const e = await errorPromise;
			assert.ok(e instanceof UserDataSyncStoreError);
			assert.deepStrictEqual((<UserDataSyncStoreError>e).code, UserDataSyncErrorCode.TooManyRequests);
		});
	});

	test('test auto sync is suspended when server donot accepts requests', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer(5, 1);

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

			while (target.requests.length < 5) {
				await testObject.sync();
			}

			target.reset();
			await testObject.sync();

			assert.deepStrictEqual(target.requests, []);
		});
	});

	test('test cache control header with no cache is sent when triggered with disable cache option', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer(5, 1);

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.triggerSync(['some reason'], { disableCache: true });
			assert.strictEqual(target.requestsWithAllHeaders[0].headers!['Cache-Control'], 'no-cache');
		});
	});

	test('test cache control header is not sent when triggered without disable cache option', async () => {
		await runWithFakedTimers({}, async () => {
			const target = new UserDataSyncTestServer(5, 1);

			const testClient = disposableStore.add(new UserDataSyncClient(target));
			await testClient.setUp();
			const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

			await testObject.triggerSync(['some reason']);
			assert.strictEqual(target.requestsWithAllHeaders[0].headers!['Cache-Control'], undefined);
		});
	});

});
