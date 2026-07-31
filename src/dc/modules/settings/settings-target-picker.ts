/**
 * Dardcor Code - Settings Scope Target Picker (User / Workspace / Folder)
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';

export type SettingsTarget = 'user' | 'workspace' | 'folder';

export interface ISettingsTargetInfo {
	readonly target: SettingsTarget;
	readonly label: string;
	readonly description: string;
}

export class SettingsTargetPicker extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<SettingsTarget>());
	readonly onDidChange: Event<SettingsTarget> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private _target: SettingsTarget = 'user';
	private _hasWorkspace = false;
	private _hasFolder = false;

	constructor(parentDom: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-settings-target-picker');
		this._container.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #2a2d2e;';
		parentDom.appendChild(this._container);
		this.render();
	}

	get target(): SettingsTarget {
		return this._target;
	}

	public setTarget(target: SettingsTarget): void {
		if (target === 'workspace' && !this._hasWorkspace) {
			return;
		}
		if (target === 'folder' && !this._hasFolder) {
			return;
		}
		if (this._target !== target) {
			this._target = target;
			this._onDidChange.fire(this._target);
			this.render();
		}
	}

	public setWorkspaceState(hasWorkspace: boolean): void {
		this._hasWorkspace = hasWorkspace;
		this.render();
	}

	public setFolderState(hasFolder: boolean): void {
		this._hasFolder = hasFolder;
		this.render();
	}

	public static getTargetInfo(target: SettingsTarget): ISettingsTargetInfo {
		switch (target) {
			case 'user':
				return { target, label: 'Pengguna', description: 'Berlaku untuk semua workspace' };
			case 'workspace':
				return { target, label: 'Workspace', description: 'Berlaku untuk workspace ini' };
			case 'folder':
				return { target, label: 'Folder', description: 'Berlaku untuk folder ini' };
		}
	}

	public render(): void {
		this._container.textContent = '';
		const label = $<HTMLElement>('span');
		label.textContent = 'Target:';
		label.style.cssText = 'font-size:11px;color:#8a8a8a;';
		this._container.appendChild(label);

		const targets: Array<{ id: SettingsTarget; enabled: boolean }> = [
			{ id: 'user', enabled: true },
			{ id: 'workspace', enabled: this._hasWorkspace },
			{ id: 'folder', enabled: this._hasFolder }
		];
		for (const item of targets) {
			const btn = $<HTMLButtonElement>('button');
			btn.textContent = SettingsTargetPicker.getTargetInfo(item.id).label;
			btn.disabled = !item.enabled;
			btn.style.cssText = `background:${this._target === item.id && item.enabled ? '#007fd4' : '#2a2d2e'};border:none;border-radius:2px;color:${item.enabled ? '#cccccc' : '#6b6b6b'};font-size:12px;padding:3px 10px;cursor:${item.enabled ? 'pointer' : 'not-allowed'};`;
			if (item.enabled) {
				this._register(addDisposableListener(btn, 'click', () => {
					this.setTarget(item.id);
				}));
			}
			this._container.appendChild(btn);
		}
	}
}
