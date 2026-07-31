import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTasks {
	private readonly _taskProviders = new Map<string, any>();

	private readonly _onDidStartTask = new Emitter<any>();
	readonly onDidStartTask = this._onDidStartTask.event;

	private readonly _onDidEndTask = new Emitter<any>();
	readonly onDidEndTask = this._onDidEndTask.event;

	registerTaskProvider(type: string, provider: any): IDisposable {
		this._taskProviders.set(type, provider);
		return {
			dispose: () => {
				this._taskProviders.delete(type);
			}
		};
	}

	async fetchTasks(filter?: any): Promise<any[]> {
		const result: any[] = [];
		for (const provider of this._taskProviders.values()) {
			const tasks = await provider.provideTasks();
			if (tasks) {
				result.push(...tasks);
			}
		}
		return result;
	}

	executeTask(task: any): Promise<any> {
		this._onDidStartTask.fire({ execution: { task } });
		return Promise.resolve({
			task,
			terminate: () => {
				this._onDidEndTask.fire({ execution: { task } });
			}
		});
	}
}
