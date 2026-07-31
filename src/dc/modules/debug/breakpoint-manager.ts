/**
 * Dardcor Code - Code Line Breakpoint Store & Toggle Manager
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { URI } from '../../core/types/uri';
import type { DebugSession } from './debug-session';

export interface IBreakpoint {
	readonly id: string;
	readonly resource: URI;
	readonly line: number;
	readonly enabled: boolean;
	readonly verified?: boolean;
}

export class BreakpointManager extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _breakpoints = new Map<string, IBreakpoint[]>();
	private _idCounter = 1;

	public getBreakpoints(resource?: URI): IBreakpoint[] {
		if (!resource) {
			const all: IBreakpoint[] = [];
			for (const list of this._breakpoints.values()) {
				all.push(...list);
			}
			return all;
		}
		return this._breakpoints.get(resource.toString()) ?? [];
	}

	public getBreakpoint(resource: URI, line: number): IBreakpoint | undefined {
		const list = this._breakpoints.get(resource.toString());
		return list?.find(bp => bp.line === line);
	}

	public toggle(resource: URI, line: number, enabled = true): IBreakpoint | undefined {
		const key = resource.toString();
		const list = this._breakpoints.get(key) ?? [];
		const existing = list.find(bp => bp.line === line);
		if (existing) {
			this._remove(resource, line);
			return undefined;
		}
		const bp: IBreakpoint = {
			id: `bp-${this._idCounter++}`,
			resource,
			line,
			enabled
		};
		list.push(bp);
		list.sort((a, b) => a.line - b.line);
		this._breakpoints.set(key, list);
		this._onDidChange.fire();
		return bp;
	}

	public remove(resource: URI, line: number): void {
		this._remove(resource, line);
	}

	public removeAllForResource(resource: URI): void {
		this._breakpoints.delete(resource.toString());
		this._onDidChange.fire();
	}

	public clearAll(): void {
		this._breakpoints.clear();
		this._onDidChange.fire();
	}

	public setEnabled(bp: IBreakpoint, enabled: boolean): void {
		const list = this._breakpoints.get(bp.resource.toString());
		const found = list?.find(item => item.id === bp.id);
		if (found) {
			(found as { enabled: boolean }).enabled = enabled;
			this._onDidChange.fire();
		}
	}

	public markVerified(bp: IBreakpoint, verified: boolean): void {
		const list = this._breakpoints.get(bp.resource.toString());
		const found = list?.find(item => item.id === bp.id);
		if (found) {
			(found as { verified: boolean }).verified = verified;
			this._onDidChange.fire();
		}
	}

	public async sendTo(session: DebugSession): Promise<void> {
		const all = this.getBreakpoints();
		if (all.length > 0) {
			await session.setBreakpoints(all);
		}
	}

	private _remove(resource: URI, line: number): void {
		const key = resource.toString();
		const list = this._breakpoints.get(key);
		if (!list) {
			return;
		}
		const idx = list.findIndex(bp => bp.line === line);
		if (idx !== -1) {
			list.splice(idx, 1);
		}
		if (list.length === 0) {
			this._breakpoints.delete(key);
		}
		this._onDidChange.fire();
	}
}
