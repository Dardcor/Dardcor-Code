/**
 * Dardcor Code - launch.json Configuration Editor & Debug Launch Picker
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';

export interface ILaunchConfiguration {
	readonly name: string;
	readonly type: string;
	readonly request: string;
	readonly program?: string;
	readonly args?: string[];
	readonly env?: Record<string, string>;
	readonly cwd?: string;
	readonly port?: number;
	readonly stopOnEntry?: boolean;
	readonly sourceMaps?: boolean;
	readonly outFiles?: string[];
	readonly preLaunchTask?: string;
	readonly presentation?: { group?: string; order?: number; hidden?: boolean };
}

export class LaunchConfig extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidLaunch = this._register(new Emitter<ILaunchConfiguration>());
	readonly onDidLaunch: Event<ILaunchConfiguration> = this._onDidLaunch.event;

	private _configurations: ILaunchConfiguration[] = [];
	private _workspaceUri: URI | undefined;

	constructor(initial: ILaunchConfiguration[] = []) {
		super();
		this._configurations = initial;
	}

	get configurations(): ILaunchConfiguration[] {
		return [...this._configurations];
	}

	public setWorkspace(uri: URI): void {
		this._workspaceUri = uri;
	}

	public getLaunchFileUri(): URI | undefined {
		if (!this._workspaceUri) {
			return undefined;
		}
		return URI.file(Path.join(this._workspaceUri.path, '.vscode', 'launch.json'));
	}

	public add(config: ILaunchConfiguration): void {
		this._configurations.push(config);
		this._onDidChange.fire();
	}

	public remove(name: string): void {
		const before = this._configurations.length;
		this._configurations = this._configurations.filter(c => c.name !== name);
		if (this._configurations.length !== before) {
			this._onDidChange.fire();
		}
	}

	public get(name: string): ILaunchConfiguration | undefined {
		return this._configurations.find(c => c.name === name);
	}

	public launch(config: ILaunchConfiguration): void {
		this._onDidLaunch.fire(config);
	}

	public async parseLaunchJson(text: string): Promise<void> {
		try {
			const parsed = JSON.parse(text);
			const configs = parsed?.configurations;
			if (Array.isArray(configs)) {
				this._configurations = configs.filter((c): c is ILaunchConfiguration =>
					!!c && typeof c.name === 'string' && typeof c.type === 'string' && typeof c.request === 'string');
				this._onDidChange.fire();
			}
		} catch (err) {
			console.error('Gagal mengurai launch.json:', err);
		}
	}

	public toLaunchJson(pretty = true): string {
		return JSON.stringify({ version: '0.2.0', configurations: this._configurations }, null, pretty ? 2 : undefined);
	}

	public renderPicker(parentDom: HTMLElement): HTMLElement {
		const container = $<HTMLElement>('div', 'dc-launch-picker');
		container.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:6px;';
		const title = $<HTMLElement>('div');
		title.textContent = 'PILIH KONFIGURASI';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;padding:2px 4px 6px;';
		container.appendChild(title);
		const render = (): void => {
			clearNode(container);
			container.appendChild(title);
			for (const config of this._configurations) {
				const row = $<HTMLElement>('div');
				row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;user-select:none;border-radius:2px;';
				row.addEventListener('mouseenter', () => {
					row.style.background = '#2a2d2e';
				});
				row.addEventListener('mouseleave', () => {
					row.style.background = 'transparent';
				});
				const icon = $<HTMLElement>('span');
				icon.textContent = '\u25B6';
				icon.style.cssText = 'color:#4ec9b0;font-size:10px;';
				const name = $<HTMLElement>('span');
				name.textContent = config.name;
				name.style.cssText = 'font-size:13px;color:#cccccc;flex:1;';
				const type = $<HTMLElement>('span');
				type.textContent = `${config.type} \u00B7 ${config.request}`;
				type.style.cssText = 'font-size:11px;color:#8a8a8a;';
				row.appendChild(icon);
				row.appendChild(name);
				row.appendChild(type);
				this._register(addDisposableListener(row, 'click', () => this.launch(config)));
				container.appendChild(row);
			}
			if (this._configurations.length === 0) {
				const empty = $<HTMLElement>('div');
				empty.textContent = 'Tidak ada konfigurasi. Buat launch.json terlebih dahulu.';
				empty.style.cssText = 'padding:8px;color:#8a8a8a;font-size:12px;';
				container.appendChild(empty);
			}
		};
		render();
		this._register(this.onDidChange(render));
		parentDom.appendChild(container);
		return container;
	}
}
