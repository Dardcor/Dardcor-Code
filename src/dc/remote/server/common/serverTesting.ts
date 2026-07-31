import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerTestItem {
	readonly id: string;
	readonly label: string;
	readonly uri?: string;
	readonly range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly children?: IServerTestItem[];
	readonly tags?: string[];
	readonly busy?: boolean;
	readonly canResolveChildren?: boolean;
}

export type ServerTestRunState = 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'errored';

export interface IServerTestResult {
	readonly testId: string;
	readonly state: ServerTestRunState;
	readonly duration?: number;
	readonly message?: string;
	readonly location?: { uri: string; line: number };
}

export interface IServerTestRunProfile {
	readonly profileId: number;
	readonly label: string;
	readonly group: 'run' | 'debug' | 'coverage';
	readonly isDefault: boolean;
}

export interface IServerTestingService {
	readonly onDidChangeTests: Event<void>;
	readonly onDidChangeTestResult: Event<IServerTestResult>;
	readonly onTestRunStarted: Event<string>;
	readonly onTestRunCompleted: Event<string>;
	getTests(): IServerTestItem[];
	runTests(testIds: string[], profileId?: number): Promise<IServerTestResult[]>;
	debugTests(testIds: string[], profileId?: number): Promise<IServerTestResult[]>;
	cancelTestRun(runId: string): void;
	getTestResults(testId: string): IServerTestResult[];
	getRunProfiles(): IServerTestRunProfile[];
	registerTestProvider(provider: { getTests(): IServerTestItem[] }): IDisposable;
	refreshTests(): Promise<void>;
}

export class ServerTestingCommon implements IServerTestingService {
	private readonly _tests: IServerTestItem[] = [];
	private readonly _results = new Map<string, IServerTestResult[]>();
	private readonly _providers: { getTests(): IServerTestItem[] }[] = [];

	private readonly _onDidChangeTests = new Emitter<void>();
	readonly onDidChangeTests: Event<void> = this._onDidChangeTests.event;

	private readonly _onDidChangeTestResult = new Emitter<IServerTestResult>();
	readonly onDidChangeTestResult: Event<IServerTestResult> = this._onDidChangeTestResult.event;

	private readonly _onTestRunStarted = new Emitter<string>();
	readonly onTestRunStarted: Event<string> = this._onTestRunStarted.event;

	private readonly _onTestRunCompleted = new Emitter<string>();
	readonly onTestRunCompleted: Event<string> = this._onTestRunCompleted.event;

	getTests(): IServerTestItem[] { return [...this._tests]; }

	async runTests(testIds: string[], _profileId?: number): Promise<IServerTestResult[]> {
		const runId = `run-${Date.now()}`;
		this._onTestRunStarted.fire(runId);
		const results: IServerTestResult[] = testIds.map(id => ({ testId: id, state: 'passed' as ServerTestRunState, duration: 0 }));
		for (const r of results) {
			const existing = this._results.get(r.testId) || [];
			existing.push(r);
			this._results.set(r.testId, existing);
			this._onDidChangeTestResult.fire(r);
		}
		this._onTestRunCompleted.fire(runId);
		return results;
	}

	async debugTests(testIds: string[], profileId?: number): Promise<IServerTestResult[]> {
		return this.runTests(testIds, profileId);
	}

	cancelTestRun(_runId: string): void {}

	getTestResults(testId: string): IServerTestResult[] {
		return this._results.get(testId) || [];
	}

	getRunProfiles(): IServerTestRunProfile[] {
		return [
			{ profileId: 1, label: 'Run', group: 'run', isDefault: true },
			{ profileId: 2, label: 'Debug', group: 'debug', isDefault: false },
			{ profileId: 3, label: 'Coverage', group: 'coverage', isDefault: false }
		];
	}

	registerTestProvider(provider: { getTests(): IServerTestItem[] }): IDisposable {
		this._providers.push(provider);
		return { dispose: () => { const idx = this._providers.indexOf(provider); if (idx >= 0) this._providers.splice(idx, 1); } };
	}

	async refreshTests(): Promise<void> {
		this._tests.length = 0;
		for (const p of this._providers) {
			this._tests.push(...p.getTests());
		}
		this._onDidChangeTests.fire();
	}
}
