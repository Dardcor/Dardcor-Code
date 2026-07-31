/**
 * Dardcor Code - Installed Extension Background Update Check Notification
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { IExtensionInfo, ExtensionRegistry } from './extensions-viewlet';

const UPDATE_CHECKER_STYLE_ID = 'dc-extension-update-checker-styles';

export interface IExtensionUpdate {
	readonly extension: IExtensionInfo;
	readonly currentVersion: string;
	readonly latestVersion: string;
}

export interface IExtensionUpdateSource {
	readonly id: string;
	readonly latestVersion: string;
	readonly releaseNotes?: string;
}

export class ExtensionUpdateChecker extends Disposable {
	private readonly _onDidFindUpdates = this._register(new Emitter<IExtensionUpdate[]>());
	readonly onDidFindUpdates: Event<IExtensionUpdate[]> = this._onDidFindUpdates.event;

	private readonly _onDidCheck = this._register(new Emitter<void>());
	readonly onDidCheck: Event<void> = this._onDidCheck.event;

	private readonly _registry: ExtensionRegistry;
	private readonly _updateSources = new Map<string, IExtensionUpdateSource>();
	private _checkInterval: any = undefined;
	private _checkInProgress = false;
	private _lastUpdates: IExtensionUpdate[] = [];

	constructor(registry: ExtensionRegistry) {
		super();
		this._registry = registry;
		this._register(registry.onDidChange(() => {
			if (this._updatesEnabled) {
				void this.checkForUpdates();
			}
		}));
	}

	private _updatesEnabled = true;

	public setUpdateEnabled(enabled: boolean): void {
		this._updatesEnabled = enabled;
	}

	public registerUpdateSource(source: IExtensionUpdateSource): void {
		this._updateSources.set(source.id, source);
	}

	public registerUpdateSources(sources: IExtensionUpdateSource[]): void {
		for (const source of sources) {
			this._updateSources.set(source.id, source);
		}
	}

	public start(intervalMs = 60 * 60 * 1000): void {
		if (this._checkInterval) {
			return;
		}
		this._checkInterval = setInterval(() => {
			void this.checkForUpdates();
		}, intervalMs);
	}

	public stop(): void {
		if (this._checkInterval) {
			clearInterval(this._checkInterval);
			this._checkInterval = undefined;
		}
	}

	public get lastUpdates(): IExtensionUpdate[] {
		return [...this._lastUpdates];
	}

	public get pendingUpdateCount(): number {
		return this._lastUpdates.length;
	}

	public async checkForUpdates(): Promise<IExtensionUpdate[]> {
		if (this._checkInProgress) {
			return this._lastUpdates;
		}
		this._checkInProgress = true;
		try {
			const updates: IExtensionUpdate[] = [];
			for (const ext of this._registry.list()) {
				if (!ext.installed) {
					continue;
				}
				const source = this._updateSources.get(ext.id);
				if (!source) {
					continue;
				}
				if (ExtensionUpdateChecker.isNewerVersion(source.latestVersion, ext.version)) {
					updates.push({
						extension: ext,
						currentVersion: ext.version,
						latestVersion: source.latestVersion
					});
				}
			}
			this._lastUpdates = updates;
			if (updates.length > 0) {
				this._onDidFindUpdates.fire(updates);
			}
			this._onDidCheck.fire();
			return updates;
		} finally {
			this._checkInProgress = false;
		}
	}

	public async updateExtension(id: string): Promise<boolean> {
		const source = this._updateSources.get(id);
		const ext = this._registry.get(id);
		if (!source || !ext) {
			return false;
		}
		const updated: IExtensionInfo = { ...ext, version: source.latestVersion };
		this._registry.add(updated);
		this._lastUpdates = this._lastUpdates.filter(u => u.extension.id !== id);
		return true;
	}

	public renderNotification(container: HTMLElement, onUpdate: (update: IExtensionUpdate) => void): void {
		CssInjector.inject(UPDATE_CHECKER_STYLE_ID, `
			.dc-update-banner { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #252526; border-bottom: 1px solid #2a2d2e; font-size: 12px; color: #cccccc; }
			.dc-update-banner button { background: #0e639c; border: none; color: white; border-radius: 2px; font-size: 11px; padding: 2px 10px; cursor: pointer; }
		`);
		clearNode(container);

		const render = (): void => {
			clearNode(container);
			if (this._lastUpdates.length === 0) {
				return;
			}
			const banner = $<HTMLElement>('div', 'dc-update-banner');
			const label = $<HTMLElement>('span');
			label.textContent = `${this._lastUpdates.length} ekstensi memiliki pembaruan tersedia`;
			label.style.flex = '1';
			const installAll = $<HTMLButtonElement>('button');
			installAll.textContent = 'Perbarui Semua';
			installAll.addEventListener('click', () => {
				void this._updateAll(onUpdate);
			});
			banner.appendChild(label);
			banner.appendChild(installAll);
			container.appendChild(banner);
		};

		this._register(this.onDidFindUpdates(() => render()));
		render();
	}

	private async _updateAll(onUpdate: (update: IExtensionUpdate) => void): Promise<void> {
		for (const update of [...this._lastUpdates]) {
			await this.updateExtension(update.extension.id);
			onUpdate(update);
		}
	}

	public static isNewerVersion(latest: string, current: string): boolean {
		const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
		const a = parse(latest);
		const b = parse(current);
		const length = Math.max(a.length, b.length);
		for (let i = 0; i < length; i++) {
			const diff = (a[i] ?? 0) - (b[i] ?? 0);
			if (diff !== 0) {
				return diff > 0;
			}
		}
		return false;
	}

	public dispose(): void {
		this.stop();
		super.dispose();
	}
}
