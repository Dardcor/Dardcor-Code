/**
 * Dardcor Code - Extension Pack Grouping & Bulk Install
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { IExtensionInfo } from './extensions-viewlet';

export interface IExtensionPack {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly extensionIds: string[];
}

export class ExtensionPackManager extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _packs = new Map<string, IExtensionPack>();
	private _installed = new Set<string>();

	constructor() {
		super();
	}

	get packs(): IExtensionPack[] {
		return [...this._packs.values()];
	}

	public registerPack(pack: IExtensionPack): void {
		this._packs.set(pack.id, pack);
		this._onDidChange.fire();
	}

	public unregisterPack(id: string): void {
		if (this._packs.delete(id)) {
			this._onDidChange.fire();
		}
	}

	public getPack(id: string): IExtensionPack | undefined {
		return this._packs.get(id);
	}

	public setInstalled(extensionId: string, installed: boolean): void {
		if (installed) {
			this._installed.add(extensionId);
		} else {
			this._installed.delete(extensionId);
		}
		this._onDidChange.fire();
	}

	public isInstalled(extensionId: string): boolean {
		return this._installed.has(extensionId);
	}

	public getPackProgress(pack: IExtensionPack): { installed: number; total: number; pct: number } {
		const total = pack.extensionIds.length;
		const installed = pack.extensionIds.filter(id => this._installed.has(id)).length;
		return { installed, total, pct: total === 0 ? 0 : Math.round((installed / total) * 100) };
	}

	public getMissing(pack: IExtensionPack): string[] {
		return pack.extensionIds.filter(id => !this._installed.has(id));
	}

	public installAll(pack: IExtensionPack): Promise<void> {
		const missing = this.getMissing(pack);
		for (const id of missing) {
			this._installed.add(id);
		}
		this._onDidChange.fire();
		return Promise.resolve();
	}

	public detectFromExtensions(extensions: IExtensionInfo[]): void {
		for (const extension of extensions) {
			this._installed.add(extension.id);
		}
		for (const pack of this._packs.values()) {
			this.getPackProgress(pack);
		}
		this._onDidChange.fire();
	}

	public static builtInPacks(): IExtensionPack[] {
		return [
			{
				id: 'frontend',
				name: 'Frontend Toolkit',
				description: 'Alat untuk pengembangan web frontend',
				extensionIds: ['esbenp.prettier-vscode', 'dbaeumer.vscode-eslint', 'ritwickdey.liveserver', 'ms-vscode.vscode-typescript-next']
			},
			{
				id: 'python',
				name: 'Python Developer',
				description: 'Peralatan lengkap untuk Python',
				extensionIds: ['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.debugpy', 'njpwerner.autodocstring']
			},
			{
				id: 'cpp',
				name: 'C/C++ Developer',
				description: 'Pengembangan C/C++ dengan debugging',
				extensionIds: ['ms-vscode.cpptools', 'ms-vscode.cmake-tools', 'twxs.cmake', 'xaver.clang-format']
			},
			{
				id: 'git',
				name: 'Git & Collaboration',
				description: 'Alat untuk alur kerja git',
				extensionIds: ['eamodio.gitlens', 'mhutchie.git-graph', 'github.vscode-pull-request-github', 'waderyan.gitblame']
			}
		];
	}
}
