/**
 * Dardcor Code - Quick Panel Tab Change Keyboard Bindings (Ctrl+J)
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { PanelPart } from './panel-part.js';
import { PanelRegistry, IPanelDescriptor } from './panel-registry.js';
import { CommandRegistry } from '../../../services/commands/command-service.js';

export interface IPanelSwitcherOptions {
	readonly registry?: PanelRegistry;
	readonly toggleKey?: string;
	readonly cycleKey?: string;
	readonly attachGlobalKeyboard?: boolean;
}

export interface IPanelSwitchEvent {
	readonly panelId: string | null;
	readonly action: 'toggle' | 'switch' | 'cycle';
}

export class PanelSwitcher extends Disposable {
	private readonly _panelPart: PanelPart;
	private readonly _registry: PanelRegistry;
	private readonly _toggleKey: string;
	private readonly _cycleKey: string;
	private _lastCycledId: string | null = null;

	private readonly _onDidSwitch = this._register(new Emitter<IPanelSwitchEvent>());
	readonly onDidSwitch: Event<IPanelSwitchEvent> = this._onDidSwitch.event;

	constructor(
		panelPart: PanelPart,
		options: IPanelSwitcherOptions = {}
	) {
		super();
		this._panelPart = panelPart;
		this._registry = options.registry ?? PanelRegistry.instance;
		this._toggleKey = options.toggleKey ?? 'j';
		this._cycleKey = options.cycleKey ?? 'j';

		if (options.attachGlobalKeyboard !== false) {
			const onKeyDown = (e: KeyboardEvent) => this._onKeyDown(e);
			document.addEventListener('keydown', onKeyDown, true);
			this._register({ dispose: () => document.removeEventListener('keydown', onKeyDown, true) });
		}

		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.togglePanel',
			handler: () => this.toggle(),
		}));
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.quickSwitchPanel',
			handler: () => this.cycle(),
		}));
	}

	get activePanel(): IPanelDescriptor | null {
		return this._panelPart.activePanel;
	}

	toggle(): void {
		if (this._panelPart.isVisible) {
			this._panelPart.hidePanel();
			this._fire(null, 'toggle');
		} else {
			const panels = this._registry.getPanels();
			const target = this._lastCycledId ?? this.activePanel?.id ?? panels[0]?.id;
			if (target) {
				this._panelPart.showPanel(target);
				this._fire(target, 'toggle');
			}
		}
	}

	switchTo(panelId: string): void {
		if (!this._registry.hasPanel(panelId)) {
			return;
		}
		if (this._panelPart.isVisible && this._panelPart.activePanel?.id === panelId) {
			this._panelPart.hidePanel();
			this._fire(null, 'switch');
			return;
		}
		this._panelPart.showPanel(panelId);
		this._lastCycledId = panelId;
		this._fire(panelId, 'switch');
	}

	cycle(direction: 'next' | 'previous' = 'next'): void {
		const panels = this._registry.getPanels();
		if (panels.length === 0) {
			return;
		}
		const currentId = this.activePanel?.id ?? this._lastCycledId ?? panels[panels.length - 1].id;
		const currentIdx = panels.findIndex(p => p.id === currentId);
		const offset = direction === 'next' ? 1 : -1;
		const nextIdx = (currentIdx + offset + panels.length) % panels.length;
		const next = panels[nextIdx];
		this._panelPart.showPanel(next.id);
		this._lastCycledId = next.id;
		this._fire(next.id, 'cycle');
	}

	cyclePrevious(): void {
		this.cycle('previous');
	}

	close(): void {
		this._panelPart.hidePanel();
		this._fire(null, 'toggle');
	}

	private _onKeyDown(e: KeyboardEvent): void {
		if (!e.ctrlKey || e.altKey || e.metaKey) {
			return;
		}
		const key = e.key.toLowerCase();
		if (key === this._toggleKey && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			this.toggle();
		} else if (key === this._cycleKey && e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			this.cyclePrevious();
		}
	}

	private _fire(panelId: string | null, action: IPanelSwitchEvent['action']): void {
		this._onDidSwitch.fire({ panelId, action });
	}

	dispose(): void {
		super.dispose();
	}
}
