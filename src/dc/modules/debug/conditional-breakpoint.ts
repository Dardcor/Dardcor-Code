/**
 * Dardcor Code - Breakpoint Condition & Hit Count Management
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export type BreakpointConditionType = 'expression' | 'hitCount';

export interface IConditionalBreakpoint {
	readonly condition: string;
	readonly type: BreakpointConditionType;
	readonly hitCount: number;
	readonly enabled: boolean;
}

export function createConditionalBreakpoint(condition: string, type: BreakpointConditionType = 'expression'): IConditionalBreakpoint {
	return {
		condition,
		type,
		hitCount: type === 'hitCount' ? Number(condition) || 1 : 0,
		enabled: true
	};
}

export class ConditionalBreakpointManager extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _conditionals = new Map<string, IConditionalBreakpoint>();

	constructor() {
		super();
	}

	public hasConditional(id: string): boolean {
		return this._conditionals.has(id);
	}

	public getConditional(id: string): IConditionalBreakpoint | undefined {
		return this._conditionals.get(id);
	}

	public setConditional(id: string, conditional: IConditionalBreakpoint): void {
		this._conditionals.set(id, { ...conditional });
		this._onDidChange.fire();
	}

	public removeConditional(id: string): void {
		if (this._conditionals.delete(id)) {
			this._onDidChange.fire();
		}
	}

	public clear(): void {
		if (this._conditionals.size > 0) {
			this._conditionals.clear();
			this._onDidChange.fire();
		}
	}

	public isSatisfied(id: string, currentHitCount: number): boolean {
		const conditional = this._conditionals.get(id);
		if (!conditional || !conditional.enabled) {
			return true;
		}
		if (conditional.type === 'expression') {
			return true;
		}
		return currentHitCount >= conditional.hitCount;
	}

	public toDapCondition(id: string): string | undefined {
		const conditional = this._conditionals.get(id);
		if (!conditional || !conditional.enabled) {
			return undefined;
		}
		return conditional.type === 'hitCount'
			? `${conditional.hitCount}`
			: conditional.condition;
	}

	public toDapHitCondition(id: string): string | undefined {
		const conditional = this._conditionals.get(id);
		if (!conditional || !conditional.enabled || conditional.type !== 'hitCount') {
			return undefined;
		}
		return String(conditional.hitCount);
	}

	public entries(): IterableIterator<[string, IConditionalBreakpoint]> {
		return this._conditionals.entries();
	}
}

export function isHitCountExpression(expression: string): boolean {
	return /^\s*(==|>=|<=|>|<|%)\s*\d+\s*$/.test(expression);
}

export function parseHitCountExpression(expression: string): number {
	const match = expression.trim().match(/(\d+)/);
	return match ? Number(match[1]) : 1;
}

export function createConditionalFromInput(input: string): IConditionalBreakpoint | undefined {
	const trimmed = input.trim();
	if (!trimmed) {
		return undefined;
	}
	if (isHitCountExpression(trimmed)) {
		return createConditionalBreakpoint(String(parseHitCountExpression(trimmed)), 'hitCount');
	}
	return createConditionalBreakpoint(trimmed, 'expression');
}
