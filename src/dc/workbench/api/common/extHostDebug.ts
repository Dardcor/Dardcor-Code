import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDebug {
	private readonly _activeDebugSessions = new Set<any>();

	private readonly _onDidStartDebugSession = new Emitter<any>();
	readonly onDidStartDebugSession = this._onDidStartDebugSession.event;

	private readonly _onDidTerminateDebugSession = new Emitter<any>();
	readonly onDidTerminateDebugSession = this._onDidTerminateDebugSession.event;

	startDebugging(folder: any | undefined, nameOrConfiguration: string | any, parentSessionOrOptions?: any): Promise<boolean> {
		return Promise.resolve(true);
	}

	get activeDebugSession(): any | undefined {
		return Array.from(this._activeDebugSessions)[0];
	}

	get activeDebugConsole(): any {
		return {
			append(value: string) { console.log(value); },
			appendLine(value: string) { console.log(value); }
		};
	}

	$acceptDebugSessionStarted(session: any): void {
		this._activeDebugSessions.add(session);
		this._onDidStartDebugSession.fire(session);
	}

	$acceptDebugSessionTerminated(session: any): void {
		this._activeDebugSessions.delete(session);
		this._onDidTerminateDebugSession.fire(session);
	}
}
