/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { observableValue, derived, autorun } from '../../src/vs/base/common/observable.js';

export function testValidUsage() {
	const obs = observableValue('test', 0);

	const validDerived = derived(reader => {
		const value = obs.read(reader);
		return value * 2;
	});

	autorun(rdr => {
		const value = validDerived.read(rdr);
		console.log('Value:', value);
	});

	const outsideValue = obs.get();
	console.log('Outside value:', outsideValue);
}

export function testInvalidUsage() {
	const obs = observableValue('test', 0);

	const invalidDerived = derived(rdr => {
		// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
		const value = obs.get();
		const validValue = obs.read(rdr);

		obs.read(undefined);

		return value * 2 + validValue;
	});

	autorun(reader => {
		// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
		const value = invalidDerived.get();
		const validValue = obs.read(reader);
		console.log('Value:', value, validValue);
	});

	derived(reader => {
		// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
		const value = obs.get();
		reader.store.add({ dispose: () => { } });
		return value;
	});
}

export function testComplexCases() {
	const obs1 = observableValue('test1', 0);
	const obs2 = observableValue('test2', 10);

	derived(reader => {
		const initial = obs1.read(reader);

		if (initial > 0) {
			// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
			return obs2.get();
		}

		return initial;
	});

	autorun(reader => {
		const process = () => {
			// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
			return obs1.get() + obs2.get();
		};

		const validValue = obs1.read(reader);
		const result = process();
		console.log('Result:', result, validValue);
	});

	derived(reader => {
		try {
			// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
			const value = obs1.get();
			const validValue = obs2.read(reader);
			return value * 2 + validValue;
		} catch (e) {
			return obs2.read(reader);
		}
	});
}

export function testValidComplexCases() {
	const obs1 = observableValue('test1', 0);
	const obs2 = observableValue('test2', 10);

	derived(reader => {
		const value1 = obs1.read(reader);
		const value2 = obs2.read(undefined);

		if (value1 > 0) {
			return value2;
		}

		return value1;
	});

	function processValues() {
		const val1 = obs1.get();
		const val2 = obs2.get();
		return val1 + val2;
	}

	autorun(reader => {
		const reactiveValue = obs1.read(reader);
		const outsideValue = processValues();
		console.log('Values:', reactiveValue, outsideValue);
	});
}

export function testEdgeCases() {
	const obs = observableValue('test', 0);

	derived(() => {
		const value = obs.get();
		return value;
	});

	derived(_someOtherName => {
		// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
		const value = obs.get();
		return value;
	});

	derived(reader => {
		// eslint-disable-next-line local/code-no-observable-get-in-reactive-context
		const value = obs.get();
		const validValue = obs.read(reader);
		return value + validValue;
	});
}

export function testQuickFixScenarios() {
	const obs = observableValue('test', 0);
	const obs2 = observableValue('test2', 10);


	derived(_reader => {
		const value = obs.read(undefined);
		return value;
	});

	derived(rdr => {
		const value = obs2.read(rdr);
		return value;
	});

	derived(ctx => {
		const someCondition = true;
		const value = (someCondition ? obs : obs2).read(ctx);
		return value;
	});

	autorun(reader => {
		const val1 = obs.read(reader);
		const val2 = obs2.read(reader);
		console.log(val1, val2);
	});
}
