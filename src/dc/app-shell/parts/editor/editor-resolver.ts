/**
 * Dardcor Code - File Extension To Custom Editor Pane Resolver
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { Path } from '../../../core/types/path.js';
import { EditorInput } from './editor-input.js';
import { EditorPane, TextEditorPane } from './editor-pane.js';

export type ResolvedEditorPaneFactory = (container: HTMLElement, input: EditorInput) => EditorPane;

export interface IEditorResolverRegistration {
	readonly extensions: string[];
	readonly factory: ResolvedEditorPaneFactory;
	readonly priority: number;
}

export interface IEditorResolverMatch {
	readonly registration: IEditorResolverRegistration;
	readonly reason: 'extension' | 'glob' | 'scheme' | 'untitled';
}

export class EditorResolver extends Disposable {
	private readonly _extensions = new Map<string, IEditorResolverRegistration>();
	private readonly _globs: { pattern: string; registration: IEditorResolverRegistration }[] = [];
	private readonly _schemes = new Map<string, IEditorResolverRegistration>();
	private _untitled: IEditorResolverRegistration | null = null;
	private _order = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	registerExtension(extensions: string[], factory: ResolvedEditorPaneFactory, priority = 100): IDisposable {
		const registration = this._createRegistration(extensions, factory, priority);
		for (const ext of extensions) {
			this._extensions.set(ext.toLowerCase(), registration);
		}
		this._onDidChange.fire();
		return this._createDisposable(registration);
	}

	registerGlob(pattern: string, factory: ResolvedEditorPaneFactory, priority = 90): IDisposable {
		const registration = this._createRegistration([pattern], factory, priority);
		this._globs.push({ pattern, registration });
		this._onDidChange.fire();
		return this._createDisposable(registration);
	}

	registerScheme(scheme: string, factory: ResolvedEditorPaneFactory, priority = 80): IDisposable {
		const registration = this._createRegistration([], factory, priority);
		this._schemes.set(scheme, registration);
		this._onDidChange.fire();
		return this._createDisposable(registration);
	}

	registerUntitled(factory: ResolvedEditorPaneFactory, priority = 70): IDisposable {
		this._untitled = this._createRegistration([], factory, priority);
		this._onDidChange.fire();
		return this._createDisposable(this._untitled);
	}

	resolveMatch(input: EditorInput): IEditorResolverMatch | null {
		const scheme = input.uri.scheme;
		if (scheme === 'untitled') {
			if (this._untitled) {
				return { registration: this._untitled, reason: 'untitled' };
			}
			return null;
		}

		const byScheme = this._schemes.get(scheme);
		if (byScheme) {
			return { registration: byScheme, reason: 'scheme' };
		}

		const ext = Path.extname(input.uri.path).toLowerCase();
		const byExt = this._extensions.get(ext);
		if (byExt) {
			return { registration: byExt, reason: 'extension' };
		}

		const path = input.uri.path;
		let bestGlob: IEditorResolverRegistration | null = null;
		let bestPriority = -1;
		for (const entry of this._globs) {
			if (this._matchesGlob(entry.pattern, path) && entry.registration.priority > bestPriority) {
				bestGlob = entry.registration;
				bestPriority = entry.registration.priority;
			}
		}
		if (bestGlob) {
			return { registration: bestGlob, reason: 'glob' };
		}
		return null;
	}

	resolveFactory(input: EditorInput): ResolvedEditorPaneFactory | null {
		return this.resolveMatch(input)?.registration.factory ?? null;
	}

	createPane(container: HTMLElement, input: EditorInput): EditorPane {
		const factory = this.resolveFactory(input);
		return factory ? factory(container, input) : new TextEditorPane(container);
	}

	getRegistrations(): IEditorResolverRegistration[] {
		const all: IEditorResolverRegistration[] = [...this._extensions.values(), ...this._globs.map(g => g.registration), ...this._schemes.values()];
		if (this._untitled) {
			all.push(this._untitled);
		}
		return all.sort((a, b) => b.priority - a.priority);
	}

	private _createRegistration(extensions: string[], factory: ResolvedEditorPaneFactory, priority: number): IEditorResolverRegistration {
		return { extensions, factory, priority: priority + this._order++ / 1000 };
	}

	private _createDisposable(registration: IEditorResolverRegistration): IDisposable {
		return {
			dispose: () => {
				for (const [ext, reg] of this._extensions) {
					if (reg === registration) {
						this._extensions.delete(ext);
					}
				}
				this._globs = this._globs.filter(g => g.registration !== registration);
				for (const [scheme, reg] of this._schemes) {
					if (reg === registration) {
						this._schemes.delete(scheme);
					}
				}
				if (this._untitled === registration) {
					this._untitled = null;
				}
				this._onDidChange.fire();
			}
		};
	}

	private _matchesGlob(pattern: string, path: string): boolean {
		const normPath = path.replace(/\\/g, '/');
		const normPattern = pattern.replace(/\\/g, '/');
		if (normPattern.startsWith('*.')) {
			return normPath.endsWith(normPattern.substring(1));
		}
		if (normPattern.endsWith('/**')) {
			const prefix = normPattern.substring(0, normPattern.length - 3);
			return normPath.startsWith(prefix);
		}
		if (normPattern.includes('*')) {
			const regex = normPattern.split('*').map(escapeRegExp).join('.*');
			return new RegExp(`^${regex}$`).test(normPath);
		}
		return normPath === normPattern;
	}

	static readonly instance = new EditorResolver();

	dispose(): void {
		this._extensions.clear();
		this._globs.length = 0;
		this._schemes.clear();
		this._untitled = null;
		super.dispose();
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
