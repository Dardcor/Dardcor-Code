import { Emitter, Event } from '../../core/events/emitter.js';

export interface IActivationContext {
	readonly languages?: string[];
	readonly commands?: string[];
	readonly files?: string[];
	readonly workspaceFolders?: string[];
	readonly uri?: string;
}

export interface IActivationEvaluation {
	readonly matches: boolean;
	readonly matchedEvents: string[];
	readonly reason?: string;
}

export type ActivationEventPattern = string;

export const ACTIVATION_EVENT_PREFIXES = ['onLanguage:', 'onCommand:', 'onDebug:', 'onView:', 'workspaceContains:', 'onStartupFinished'] as const;

export function splitActivationEvents(events: string | string[] | undefined): string[] {
	if (!events) {
		return [];
	}
	if (typeof events === 'string') {
		return [events];
	}
	return events.filter((e): e is string => typeof e === 'string' && e.length > 0);
}

export function normalizeEventPattern(pattern: string): string {
	const trimmed = pattern.trim();
	if (trimmed.endsWith('*')) {
		return trimmed.slice(0, -1);
	}
	return trimmed;
}

export function matchesEventPattern(pattern: string, value: string): boolean {
	if (pattern === '*') {
		return true;
	}
	if (pattern === value) {
		return true;
	}
	if (pattern.endsWith('*')) {
		return value.startsWith(pattern.slice(0, -1));
	}
	if (pattern.endsWith('/**')) {
		return value.startsWith(pattern.slice(0, -3));
	}
	if (pattern.includes('*')) {
		const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
		return regex.test(value);
	}
	return false;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class RemoteExtensionActivation {
	private readonly _queued: string[] = [];
	private readonly _activated = new Set<string>();

	private readonly _onDidActivate = new Emitter<string>();
	readonly onDidActivate: Event<string> = this._onDidActivate.event;

	private readonly _onDidQueueActivation = new Emitter<string>();
	readonly onDidQueueActivation: Event<string> = this._onDidQueueActivation.event;

	get activated(): string[] {
		return [...this._activated];
	}

	get queued(): string[] {
		return [...this._queued];
	}

	evaluate(events: string[], context: IActivationContext = {}): IActivationEvaluation {
		const matchedEvents: string[] = [];
		for (const raw of events) {
			const event = raw.trim();
			if (this._matches(event, context)) {
				matchedEvents.push(event);
			}
		}
		return { matches: matchedEvents.length > 0, matchedEvents };
	}

	shouldActivate(events: string[], context: IActivationContext = {}): boolean {
		return this.evaluate(events, context).matches;
	}

	queueActivation(extensionId: string): void {
		if (this._activated.has(extensionId) || this._queued.includes(extensionId)) {
			return;
		}
		this._queued.push(extensionId);
		this._onDidQueueActivation.fire(extensionId);
	}

	flush(): string[] {
		const pending = [...this._queued];
		this._queued.length = 0;
		for (const id of pending) {
			this._activated.add(id);
			this._onDidActivate.fire(id);
		}
		return pending;
	}

	markActivated(extensionId: string): void {
		const index = this._queued.indexOf(extensionId);
		if (index !== -1) {
			this._queued.splice(index, 1);
		}
		if (!this._activated.has(extensionId)) {
			this._activated.add(extensionId);
			this._onDidActivate.fire(extensionId);
		}
	}

	isActivated(extensionId: string): boolean {
		return this._activated.has(extensionId);
	}

	isQueued(extensionId: string): boolean {
		return this._queued.includes(extensionId);
	}

	matchesStartupFinished(events: string[]): boolean {
		return events.includes('*') || events.includes('onStartupFinished');
	}

	getActivationReason(events: string[], context: IActivationContext): string | null {
		const evaluation = this.evaluate(events, context);
		if (evaluation.matches) {
			return `activated by ${evaluation.matchedEvents.join(', ')}`;
		}
		return null;
	}

	private _matches(event: string, context: IActivationContext): boolean {
		if (event === '*') {
			return true;
		}
		if (event === 'onStartupFinished') {
			return context.workspaceFolders !== undefined && context.workspaceFolders.length >= 0;
		}
		for (const prefix of ACTIVATION_EVENT_PREFIXES) {
			if (event.startsWith(prefix)) {
				const pattern = event.slice(prefix.length);
				if (prefix === 'onLanguage:') {
					return (context.languages ?? []).some(lang => matchesEventPattern(pattern, lang));
				}
				if (prefix === 'onCommand:') {
					return (context.commands ?? []).some(command => matchesEventPattern(pattern, command));
				}
				if (prefix === 'workspaceContains:') {
					return (context.files ?? []).some(file => matchesEventPattern(pattern, file));
				}
				if (prefix === 'onDebug:' || prefix === 'onView:') {
					return matchesEventPattern(pattern, context.uri ?? '');
				}
				return false;
			}
		}
		return false;
	}
}
