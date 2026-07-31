import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTesting {
	createTestController(id: string, label: string): any {
		return {
			id,
			label,
			items: {
				add: (item: any) => {},
				delete: (id: string) => {},
				get: (id: string) => undefined,
				replace: (items: any[]) => {}
			},
			createTestItem: (id: string, label: string, uri?: any) => {
				return { id, label, uri, children: [] };
			},
			createTestRun: (request: any, name?: string, persist?: boolean) => {
				return {
					name,
					enqueued: () => {},
					started: () => {},
					skipped: () => {},
					passed: () => {},
					failed: () => {},
					errored: () => {},
					end: () => {}
				};
			},
			dispose: () => {}
		};
	}
}
