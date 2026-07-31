/**
 * Dardcor Code - Keybinding Service (Task 116)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { ChordKeybinding, IKeybinding } from '../../core/types/keycodes.js';
import { IContextKeyService } from '../contextkey/contextkey-service.js';
import { KeybindingResolver, IKeybindingRule } from './keybinding-resolver.js';

export interface IResolvedKeybindingMatch {
	readonly command: string;
	readonly isChord: boolean;
}

export interface IKeybindingService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeKeybindings: Event<void>;
	registerKeybindingRule(rule: IKeybindingRule): IDisposable;
	unregisterKeybindings(commandId: string): void;
	lookupKeybinding(commandId: string): ChordKeybinding | undefined;
	resolveKeybinding(keybinding: IKeybinding): IResolvedKeybindingMatch | null;
	getKeybindings(): ChordKeybinding[];
	getKeybindingCount(): number;
	hasPendingChord(): boolean;
	clearPendingChord(): void;
}

export const IKeybindingService = createDecorator<IKeybindingService>('keybindingService');

export class KeybindingService extends Disposable implements IKeybindingService {
	declare readonly _serviceBrand: undefined;

	private readonly _rules: IKeybindingRule[] = [];
	private _resolver: KeybindingResolver | null = null;

	private readonly _onDidChangeKeybindings = this._register(new Emitter<void>());
	readonly onDidChangeKeybindings = this._onDidChangeKeybindings.event;

	constructor(private readonly _contextKeyService: IContextKeyService) {
		super();
	}

	public registerKeybindingRule(rule: IKeybindingRule): IDisposable {
		this._rules.push(rule);
		this._rebuild();
		let disposed = false;
		return toDisposable(() => {
			if (disposed) {
				return;
			}
			disposed = true;
			const index = this._rules.indexOf(rule);
			if (index >= 0) {
				this._rules.splice(index, 1);
				this._rebuild();
			}
		});
	}

	public unregisterKeybindings(commandId: string): void {
		const before = this._rules.length;
		this._rules.splice(0, this._rules.length, ...this._rules.filter((r) => r.command !== commandId));
		if (this._rules.length !== before) {
			this._rebuild();
		}
	}

	public lookupKeybinding(commandId: string): ChordKeybinding | undefined {
		return this._getResolver().lookupKeybinding(commandId);
	}

	public resolveKeybinding(keybinding: IKeybinding): IResolvedKeybindingMatch | null {
		const match = this._getResolver().resolve(
			(when) => !when || this._contextKeyService.evaluate(when),
			keybinding
		);
		if (!match) {
			return null;
		}
		return { command: match.command, isChord: match.isChord };
	}

	public getKeybindings(): ChordKeybinding[] {
		const result: ChordKeybinding[] = [];
		const seen = new Set<string>();
		for (const rule of this._rules) {
			const hash = rule.keybinding.parts.map((p) => p.toString()).join('|');
			if (!seen.has(hash)) {
				seen.add(hash);
				result.push(rule.keybinding);
			}
		}
		return result;
	}

	public getKeybindingCount(): number {
		return this._rules.length;
	}

	public hasPendingChord(): boolean {
		return this._getResolver().hasPendingChord();
	}

	public clearPendingChord(): void {
		this._getResolver().clearPendingChord();
	}

	private _getResolver(): KeybindingResolver {
		if (!this._resolver) {
			this._resolver = new KeybindingResolver(this._rules);
		}
		return this._resolver;
	}

	private _rebuild(): void {
		this._resolver = null;
		this._onDidChangeKeybindings.fire();
	}
}
