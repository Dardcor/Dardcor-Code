/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { StorageScope, IStorageService, StorageTarget } from '../../../platform/storage/common/storage.js';
import { Memento } from '../../common/memento.js';
import { TestStorageService } from './workbenchTestServices.js';

suite('Memento', () => {
	const disposables = new DisposableStore();
	let storage: IStorageService;

	setup(() => {
		storage = disposables.add(new TestStorageService());
		Memento.clear(StorageScope.APPLICATION);
		Memento.clear(StorageScope.PROFILE);
		Memento.clear(StorageScope.WORKSPACE);
	});

	teardown(() => {
		disposables.clear();
	});

	test('Loading and Saving Memento with Scopes', () => {
		const myMemento = new Memento<{ foo: number[] | string }>('memento.test', storage);

		let memento = myMemento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
		memento.foo = [1, 2, 3];
		let applicationMemento = myMemento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual(applicationMemento, memento);

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		memento.foo = [4, 5, 6];
		let profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(profileMemento, memento);

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert(memento);
		memento.foo = 'Hello World';

		myMemento.saveMemento();

		memento = myMemento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: [1, 2, 3] });
		applicationMemento = myMemento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual(applicationMemento, memento);

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: [4, 5, 6] });
		profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(profileMemento, memento);

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: 'Hello World' });

		assert.deepStrictEqual(JSON.parse(storage.get('memento/memento.test', StorageScope.APPLICATION)!), { foo: [1, 2, 3] });
		assert.deepStrictEqual(JSON.parse(storage.get('memento/memento.test', StorageScope.PROFILE)!), { foo: [4, 5, 6] });
		assert.deepStrictEqual(JSON.parse(storage.get('memento/memento.test', StorageScope.WORKSPACE)!), { foo: 'Hello World' });

		memento = myMemento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
		delete memento.foo;

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		delete memento.foo;

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		delete memento.foo;

		myMemento.saveMemento();

		memento = myMemento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, {});

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, {});

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, {});

		assert.strictEqual(storage.get('memento/memento.test', StorageScope.APPLICATION, null!), null);
		assert.strictEqual(storage.get('memento/memento.test', StorageScope.PROFILE, null!), null);
		assert.strictEqual(storage.get('memento/memento.test', StorageScope.WORKSPACE, null!), null);
	});

	test('Save and Load', () => {
		const myMemento = new Memento<{ foo: number[] | string }>('memento.test', storage);

		let memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		memento.foo = [1, 2, 3];

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert(memento);
		memento.foo = 'Hello World';

		myMemento.saveMemento();

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: [1, 2, 3] });
		let profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(profileMemento, memento);

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: 'Hello World' });

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		memento.foo = [4, 5, 6];

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert(memento);
		memento.foo = 'World Hello';

		myMemento.saveMemento();

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: [4, 5, 6] });
		profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(profileMemento, memento);

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: 'World Hello' });

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		delete memento.foo;

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		delete memento.foo;

		myMemento.saveMemento();

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, {});

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, {});
	});

	test('Save and Load - 2 Components with same id', () => {
		const myMemento = new Memento<any>('memento.test', storage);
		const myMemento2 = new Memento<any>('memento.test', storage);

		let memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		memento.foo = [1, 2, 3];

		memento = myMemento2.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		memento.bar = [1, 2, 3];

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert(memento);
		memento.foo = 'Hello World';

		memento = myMemento2.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert(memento);
		memento.bar = 'Hello World';

		myMemento.saveMemento();
		myMemento2.saveMemento();

		memento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: [1, 2, 3], bar: [1, 2, 3] });
		let profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(profileMemento, memento);

		memento = myMemento2.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: [1, 2, 3], bar: [1, 2, 3] });
		profileMemento = myMemento2.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		assert.deepStrictEqual(profileMemento, memento);

		memento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: 'Hello World', bar: 'Hello World' });

		memento = myMemento2.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.deepStrictEqual(memento, { foo: 'Hello World', bar: 'Hello World' });
	});

	test('Clear Memento', () => {
		let myMemento = new Memento<{ foo: string; bar: string }>('memento.test', storage);

		let profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		profileMemento.foo = 'Hello World';

		let workspaceMemento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		workspaceMemento.bar = 'Hello World';

		myMemento.saveMemento();

		storage = disposables.add(new TestStorageService());
		Memento.clear(StorageScope.PROFILE);
		Memento.clear(StorageScope.WORKSPACE);

		myMemento = new Memento('memento.test', storage);
		profileMemento = myMemento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		workspaceMemento = myMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);

		assert.deepStrictEqual(profileMemento, {});
		assert.deepStrictEqual(workspaceMemento, {});
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
