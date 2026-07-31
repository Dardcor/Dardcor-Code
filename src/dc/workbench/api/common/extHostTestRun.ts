import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTestRun {
	constructor(public readonly name?: string) {}

	enqueued(test: any): void {}
	started(test: any): void {}
	skipped(test: any): void {}
	passed(test: any, duration?: number): void {}
	failed(test: any, message: any, duration?: number): void {}
	errored(test: any, message: any, duration?: number): void {}
	appendOutput(output: string): void {}
	end(): void {}
}
