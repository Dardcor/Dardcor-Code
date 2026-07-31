/**
 * Dardcor Code - ContextKey Service
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export const IContextKeyService = createDecorator<IContextKeyService>('contextKeyService');

export interface IContextKey<T> {
	set(value: T): void;
	reset(): void;
	get(): T | undefined;
}

export interface IContextKeyService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeContext: Event<void>;
	createKey<T>(key: string, defaultValue: T): IContextKey<T>;
	getContextKeyValue<T>(key: string): T | undefined;
	evaluate(expression: string): boolean;
}

export class ContextKeyService extends Disposable implements IContextKeyService {
	declare readonly _serviceBrand: undefined;

	private readonly _context = new Map<string, any>();
	private readonly _onDidChangeContext = this._register(new Emitter<void>());

	readonly onDidChangeContext = this._onDidChangeContext.event;

	public createKey<T>(key: string, defaultValue: T): IContextKey<T> {
		this._context.set(key, defaultValue);
		return {
			set: (value: T) => {
				this._context.set(key, value);
				this._onDidChangeContext.fire();
			},
			reset: () => {
				this._context.set(key, defaultValue);
				this._onDidChangeContext.fire();
			},
			get: () => this._context.get(key)
		};
	}

	public getContextKeyValue<T>(key: string): T | undefined {
		return this._context.get(key);
	}

	public evaluate(expression: string): boolean {
		if (!expression) return true;
		if (expression.startsWith('!')) {
			return !this._context.get(expression.substring(1));
		}
		return !!this._context.get(expression);
	}
}
