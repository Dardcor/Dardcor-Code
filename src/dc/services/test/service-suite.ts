/**
 * Dardcor Code - Dependency Injection Integration Test Suite (Task 200)
 * Mirrors: vs/platform/instantiation/test/common/instantiationService.test.ts
 */

import { InstantiationService } from '../instantiation/container.js';
import { ServiceCollection } from '../instantiation/service-registry.js';
import { createDecorator } from '../instantiation/annotations.js';

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

export function runDIServiceIntegrationSuite(): boolean {
	const collection = new ServiceCollection();
	collection.set(ITestServiceA, new TestServiceA());
	const instantiation = new InstantiationService(collection);

	const serviceB = instantiation.createInstance<TestServiceB>(TestServiceB);
	if (!serviceB || !serviceB.a || serviceB.a.name !== 'TestA') {
		throw new Error('DI integration verification failed: dependency not resolved');
	}
	return true;
}
