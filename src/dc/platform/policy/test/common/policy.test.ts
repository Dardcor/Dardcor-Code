/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IStringDictionary } from '../../../../base/common/collections.js';
import { PolicyName } from '../../../../base/common/policy.js';
import { AbstractPolicyService, PolicyDefinition, PolicyValue, PolicyValueSource } from '../../common/policy.js';

class TestPolicyService extends AbstractPolicyService {
	update(name: PolicyName, value: PolicyValue | undefined, source: PolicyValueSource | undefined): boolean {
		return this.updatePolicyValue(name, value, source);
	}

	protected async _updatePolicyDefinitions(_policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<void> {
	}
}

suite('AbstractPolicyService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('serialize() omits the non-cloneable value callback so policiesData can be sent over IPC', async () => {
		const service = new TestPolicyService();

		await service.updatePolicyDefinitions({
			'WithCallback': {
				type: 'boolean',
				value: (policyData) => policyData.chat_preview_features_enabled === false ? false : undefined,
				restrictedValue: false,
			},
			'PlainDefinition': {
				type: 'string',
			}
		});

		const serialized = service.serialize();

		assert.strictEqual(typeof serialized['WithCallback'].definition.value, 'undefined');
		assert.strictEqual(serialized['WithCallback'].definition.type, 'boolean');
		assert.strictEqual(serialized['WithCallback'].definition.restrictedValue, false);
		assert.strictEqual(serialized['PlainDefinition'].definition.type, 'string');

		assert.doesNotThrow(() => structuredClone(serialized));

		service.dispose();
	});

	test('tracks value and source changes together', () => {
		const service = new TestPolicyService();
		const states: { changed: boolean; value: PolicyValue | undefined; source: PolicyValueSource | undefined }[] = [];
		const update = (value: PolicyValue | undefined, source: PolicyValueSource | undefined) => {
			const changed = service.update('Policy', value, source);
			states.push({
				changed,
				value: service.getPolicyValue('Policy'),
				source: service.getPolicyValueSource('Policy'),
			});
		};

		update(false, undefined);
		update(false, PolicyValueSource.Account);
		update(false, PolicyValueSource.AccountGate);
		update(false, PolicyValueSource.AccountGate);
		update(undefined, undefined);

		assert.deepStrictEqual(states, [
			{ changed: true, value: false, source: PolicyValueSource.Device },
			{ changed: true, value: false, source: PolicyValueSource.Account },
			{ changed: true, value: false, source: PolicyValueSource.AccountGate },
			{ changed: false, value: false, source: PolicyValueSource.AccountGate },
			{ changed: true, value: undefined, source: undefined },
		]);

		service.dispose();
	});
});
