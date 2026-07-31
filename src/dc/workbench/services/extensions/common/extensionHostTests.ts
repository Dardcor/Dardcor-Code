import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostTestsService {
	readonly onDidRunTests: Event<{ result: boolean }>;
	runTests(testExtensionUri: string): Promise<boolean>;
}

export class ExtensionHostTestsService implements IExtensionHostTestsService {
	private readonly _onDidRunTests = new Emitter<{ result: boolean }>();
	readonly onDidRunTests = this._onDidRunTests.event;

	async runTests(testExtensionUri: string): Promise<boolean> {
		console.log('Running tests for extension at:', testExtensionUri);
		// Mock test run
		const result = true;
		this._onDidRunTests.fire({ result });
		return result;
	}
}
