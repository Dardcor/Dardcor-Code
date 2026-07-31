/**
 * Dardcor Code - Service Integration Test Suite (Task 200)
 * Mirrors: vs/platform/instantiation/test/common/instantiationService.test.ts
 * Run with: node dist/dc/services/test/service-suite.js
 */

import { InstantiationService } from '../instantiation/container';
import { ServiceCollection } from '../instantiation/service-registry';
import { createDecorator } from '../instantiation/annotations';
import { Graph } from '../instantiation/graph';
import { mergeSettings } from '../userDataSync/sync-merger';
import { parseKeybinding } from '../keybinding/keybinding-parser';

export interface ITestServiceA {
	readonly name: string;
}
export const ITestServiceA = createDecorator<ITestServiceA>('testServiceA');

export interface ITestServiceB {
	readonly a: ITestServiceA;
}
export const ITestServiceB = createDecorator<ITestServiceB>('testServiceB');

class TestServiceA implements ITestServiceA {
	readonly name = 'TestA';
}

class TestServiceB implements ITestServiceB {
	constructor(@ITestServiceA public readonly a: ITestServiceA) {}
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

export function runDIServiceIntegrationSuite(): boolean {
	const collection = new ServiceCollection();
	collection.set(ITestServiceA, new TestServiceA());
	const instantiation = new InstantiationService(collection);

	const serviceB = instantiation.createInstance<TestServiceB>(TestServiceB);
	assert(serviceB && serviceB.a && serviceB.a.name === 'TestA', 'DI dependency not resolved');
	return true;
}

export function runServiceSuite(): boolean {
	const tests: Array<{ name: string; fn: () => boolean }> = [
		{
			name: 'DI service resolution',
			fn: () => runDIServiceIntegrationSuite(),
		},
		{
			name: 'DAG cycle detection',
			fn: () => {
				const g = new Graph<number>((n) => String(n));
				g.insertEdge(1, 2);
				g.insertEdge(2, 3);
				assert(g.hasCycle() === false, 'linear graph reported as cyclic');
				g.insertEdge(3, 1);
				assert(g.hasCycle() === true, 'cycle not detected');
				return true;
			},
		},
		{
			name: 'settings 3-way merge',
			fn: () => {
				const base = '{"a":1,"b":2}';
				const local = '{"a":1,"b":9}';
				const remote = '{"a":1,"b":2,"c":3}';
				const result = mergeSettings(base, local, remote);
				assert(result.hasConflicts === false, 'unexpected conflict');
				const merged = JSON.parse(result.merged);
				assert(merged.b === 9 && merged.c === 3, 'merge produced wrong values');
				return true;
			},
		},
		{
			name: 'keybinding parser macOS DSL',
			fn: () => {
				const combo = parseKeybinding('cmd+shift+p');
				assert(combo.metaKey === true && combo.shiftKey === true && combo.ctrlKey === false, 'modifier flags wrong');
				assert(combo.keyCode !== 0, 'key part not parsed');
				return true;
			},
		},
	];

	let failures = 0;
	for (const test of tests) {
		try {
			test.fn();
		} catch (err) {
			failures++;
			if (typeof process !== 'undefined' && process.stderr) {
				process.stderr.write(`[service-suite] FAIL ${test.name}: ${String(err)}\n`);
			}
		}
	}

	const pass = failures === 0;
	if (typeof process !== 'undefined' && process.stdout) {
		process.stdout.write(`[service-suite] ${tests.length - failures}/${tests.length} passed\n`);
	}
	return pass;
}

if (typeof process !== 'undefined' && typeof process.argv[1] === 'string') {
	try {
		const { pathToFileURL } = await import('node:url');
		if (import.meta.url === pathToFileURL(process.argv[1]).href) {
			const ok = runServiceSuite();
			process.exitCode = ok ? 0 : 1;
		}
	} catch {
		// Not running as the main module.
	}
}
