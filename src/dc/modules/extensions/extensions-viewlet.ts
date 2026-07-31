/**
 * Dardcor Code - Extension Marketplace Management Viewlet
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { ExtensionCardRenderer, IExtensionCardCallbacks } from './extension-card-renderer.js';
import { ExtensionDetailsEditor } from './extension-details-editor.js';

declare const require: any;

export interface IExtensionInfo {
	readonly id: string;
	readonly name: string;
	readonly publisher: string;
	readonly version: string;
	readonly description: string;
	readonly category?: string;
	readonly icon?: string;
	readonly license?: string;
	readonly readme?: string;
	readonly installed: boolean;
	readonly enabled: boolean;
	readonly builtin: boolean;
}

const EXTENSIONS_STYLE_ID = 'dc-extensions-viewlet-styles';

export const BUILT_IN_EXTENSIONS: IExtensionInfo[] = [
	{
		id: 'dc.typescript-language', name: 'TypeScript Language Basics', publisher: 'Dardcor',
		version: '1.0.0', description: 'Syntax highlighting & IntelliSense dasar untuk TypeScript dan JavaScript.',
		category: 'Languages', license: 'MIT', installed: true, enabled: true, builtin: true,
		readme: '## TypeScript Language Basics\n\nFitur dasar bahasa untuk TypeScript/JavaScript.\n\n- Syntax highlighting\n- IntelliSense dasar\n- Quick fixes umum'
	},
	{
		id: 'dc.git', name: 'Git Integration', publisher: 'Dardcor',
		version: '1.0.0', description: 'Integrasi Git: staging, commit, diff, dan blame viewer.',
		category: 'Source Control', license: 'MIT', installed: true, enabled: true, builtin: true,
		readme: '## Git Integration\n\nMenyediakan integrasi git penuh.\n\n- Source Control viewlet\n- Diff viewer\n- Gutter decorations'
	},
	{
		id: 'dc.theme-dark-modern', name: 'Dark Modern Theme', publisher: 'Dardcor',
		version: '1.0.0', description: 'Tema gelap modern default untuk Dardcor Code.',
		category: 'Themes', license: 'MIT', installed: true, enabled: true, builtin: true,
		readme: '## Dark Modern Theme\n\nTema gelap yang mengikuti palet warna VS Code Dark Modern.'
	},
	{
		id: 'dc.prettier-format', name: 'Prettier Formatter', publisher: 'Community',
		version: '2.1.0', description: 'Formatter kode menggunakan aturan Prettier (placeholder).',
		category: 'Formatters', license: 'MIT', installed: false, enabled: false, builtin: false,
		readme: '## Prettier Formatter\n\nFormat kode otomatis sesuai konfigurasi Prettier.'
	},
	{
		id: 'dc.python-debugger', name: 'Python Debugger', publisher: 'Community',
		version: '1.8.0', description: 'Debugger untuk Python berbasis DAP (placeholder).',
		category: 'Debuggers', license: 'MIT', installed: false, enabled: false, builtin: false,
		readme: '## Python Debugger\n\nDebug Python dengan breakpoint dan variabel inspection.'
	}
];

export class ExtensionRegistry extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _extensions = new Map<string, IExtensionInfo>();

	constructor(initial: IExtensionInfo[] = BUILT_IN_EXTENSIONS) {
		super();
		for (const ext of initial) {
			this._extensions.set(ext.id, ext);
		}
	}

	public list(): IExtensionInfo[] {
		return [...this._extensions.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	public get(id: string): IExtensionInfo | undefined {
		return this._extensions.get(id);
	}

	public add(extension: IExtensionInfo): void {
		this._extensions.set(extension.id, extension);
		this._onDidChange.fire();
	}

	public install(id: string): void {
		const ext = this._extensions.get(id);
		if (ext) {
			this._extensions.set(id, { ...ext, installed: true, enabled: true });
			this._onDidChange.fire();
		}
	}

	public uninstall(id: string): void {
		const ext = this._extensions.get(id);
		if (ext && !ext.builtin) {
			this._extensions.set(id, { ...ext, installed: false, enabled: false });
			this._onDidChange.fire();
		}
	}

	public setEnabled(id: string, enabled: boolean): void {
		const ext = this._extensions.get(id);
		if (ext) {
			this._extensions.set(id, { ...ext, enabled });
			this._onDidChange.fire();
		}
	}

	public async loadFromDisk(extensionsPath: string): Promise<void> {
		const fs = require('node:fs/promises');
		const pathModule = require('node:path');
		let entries: any[];
		try {
			entries = await fs.readdir(extensionsPath, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const manifestPath = pathModule.join(extensionsPath, entry.name, 'package.json');
			try {
				const raw = await fs.readFile(manifestPath, 'utf8');
				const manifest = JSON.parse(raw);
				const id = manifest.publisher && manifest.name ? `${manifest.publisher}.${manifest.name}` : entry.name;
				this.add({
					id,
					name: manifest.displayName ?? manifest.name ?? entry.name,
					publisher: manifest.publisher ?? 'unknown',
					version: manifest.version ?? '0.0.0',
					description: manifest.description ?? '',
					category: manifest.categories?.[0] ?? 'Other',
					license: manifest.license,
					installed: true,
					enabled: true,
					builtin: !!manifest.builtin
				});
			} catch {
				// manifest tidak valid, lewati
			}
		}
	}
}

export class ExtensionsViewlet extends Disposable {
	private readonly _onDidOpenExtension = this._register(new Emitter<IExtensionInfo>());
	readonly onDidOpenExtension: Event<IExtensionInfo> = this._onDidOpenExtension.event;

	private readonly _container: HTMLElement;
	private readonly _searchInput: HTMLInputElement;
	private readonly _listContainer: HTMLElement;
	private readonly _registry: ExtensionRegistry;
	private readonly _detailsEditor: ExtensionDetailsEditor;

	constructor(parentDom: HTMLElement, registry?: ExtensionRegistry) {
		super();
		this._registry = registry ?? new ExtensionRegistry();

		CssInjector.inject(EXTENSIONS_STYLE_ID, `
			.dc-extension-card { display: flex; gap: 10px; padding: 8px 12px; cursor: pointer; user-select: none; }
			.dc-extension-card:hover { background: #2a2d2e; }
			.dc-extension-card.selected { background: #37373d; }
		`);

		this._container = $<HTMLElement>('div', 'dc-extensions-viewlet');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		const header = $<HTMLElement>('div');
		header.style.cssText = 'padding:8px;border-bottom:1px solid #2a2d2e;';
		this._searchInput = $<HTMLInputElement>('input');
		this._searchInput.placeholder = 'Cari di Marketplace';
		this._searchInput.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:13px;padding:4px 8px;outline:none;';
		header.appendChild(this._searchInput);
		this._container.appendChild(header);

		this._listContainer = $<HTMLElement>('div', 'dc-extension-list');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);

		this._detailsEditor = new ExtensionDetailsEditor(this._container, this._registry);
		this._detailsEditor.hide();

		this._register(addDisposableListener(this._searchInput, 'input', () => this._renderList()));
		this._register(this._registry.onDidChange(() => this._renderList()));
		this._renderList();
	}

	get registry(): ExtensionRegistry {
		return this._registry;
	}

	private _getCallbacks(): IExtensionCardCallbacks {
		return {
			onInstall: ext => this._registry.install(ext.id),
			onUninstall: ext => this._registry.uninstall(ext.id),
			onOpen: ext => this._openDetails(ext)
		};
	}

	private _openDetails(extension: IExtensionInfo): void {
		this._listContainer.style.display = 'none';
		this._detailsEditor.open(extension, () => {
			this._listContainer.style.display = 'block';
			this._renderList();
		});
	}

	private _renderList(): void {
		clearNode(this._listContainer);
		const query = this._searchInput.value.trim().toLowerCase();
		const extensions = this._registry.list().filter(ext => {
			if (!query) {
				return true;
			}
			return ext.name.toLowerCase().includes(query)
				|| ext.publisher.toLowerCase().includes(query)
				|| ext.description.toLowerCase().includes(query)
				|| ext.category?.toLowerCase().includes(query);
		});

		if (extensions.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada ekstensi yang cocok';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._listContainer.appendChild(empty);
			return;
		}

		for (const ext of extensions) {
			const card = $<HTMLElement>('div', 'dc-extension-card');
			ExtensionCardRenderer.render(card, ext, this._getCallbacks());
			card.addEventListener('click', (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				if (target.closest('button')) {
					return;
				}
				this._openDetails(ext);
			});
			this._listContainer.appendChild(card);
		}
	}
}
