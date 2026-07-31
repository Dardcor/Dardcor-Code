/**
 * Dardcor Code - Graphical Settings GUI Editor Pane with Category Navigation
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { IConfigurationService, ConfigurationService } from '../../services/configuration/configuration-service';
import { SettingsSearch } from './settings-search';

export type ISettingType = 'string' | 'number' | 'boolean' | 'enum' | 'array';

export interface ISettingOption {
	readonly label: string;
	readonly value: string;
}

export interface ISettingDescriptor {
	readonly key: string;
	readonly title: string;
	readonly description: string;
	readonly category: string;
	readonly type: ISettingType;
	readonly defaultValue: any;
	readonly options?: ISettingOption[];
	readonly minimum?: number;
	readonly maximum?: number;
}

export const SETTINGS_CATEGORIES = ['Editor', 'Workbench', 'Terminal', 'Search', 'Files', 'Git', 'Debug'] as const;

export const DEFAULT_SETTINGS: ISettingDescriptor[] = [
	{ key: 'editor.fontSize', title: 'Editor: Font Size', description: 'Ukuran font editor dalam piksel.', category: 'Editor', type: 'number', defaultValue: 14, minimum: 8, maximum: 40 },
	{ key: 'editor.tabSize', title: 'Editor: Tab Size', description: 'Jumlah spasi untuk satu tab.', category: 'Editor', type: 'number', defaultValue: 4, minimum: 1, maximum: 16 },
	{ key: 'editor.insertSpaces', title: 'Editor: Insert Spaces', description: 'Masukkan spasi saat menekan Tab.', category: 'Editor', type: 'boolean', defaultValue: true },
	{ key: 'editor.wordWrap', title: 'Editor: Word Wrap', description: 'Kontrol pembungkusan baris.', category: 'Editor', type: 'enum', defaultValue: 'off', options: [{ label: 'Off', value: 'off' }, { label: 'On', value: 'on' }, { label: 'Word Wrap Column', value: 'wordWrapColumn' }, { label: 'Bounded', value: 'bounded' }] },
	{ key: 'editor.renderWhitespace', title: 'Editor: Render Whitespace', description: 'Cara menampilkan karakter spasi.', category: 'Editor', type: 'enum', defaultValue: 'none', options: [{ label: 'None', value: 'none' }, { label: 'Boundary', value: 'boundary' }, { label: 'All', value: 'all' }] },
	{ key: 'workbench.colorTheme', title: 'Workbench: Color Theme', description: 'Tema warna yang aktif.', category: 'Workbench', type: 'enum', defaultValue: 'Dark Modern', options: [{ label: 'Dark Modern', value: 'Dark Modern' }, { label: 'Dark High Contrast', value: 'Dark High Contrast' }, { label: 'Light Modern', value: 'Light Modern' }] },
	{ key: 'workbench.activityBar.location', title: 'Workbench: Activity Bar Location', description: 'Posisi activity bar.', category: 'Workbench', type: 'enum', defaultValue: 'side', options: [{ label: 'Side', value: 'side' }, { label: 'Top', value: 'top' }] },
	{ key: 'workbench.editor.showTabs', title: 'Workbench: Show Tabs', description: 'Tampilkan tab editor.', category: 'Workbench', type: 'boolean', defaultValue: true },
	{ key: 'terminal.integrated.shell', title: 'Terminal: Default Shell', description: 'Path shell default untuk terminal terintegrasi.', category: 'Terminal', type: 'string', defaultValue: 'powershell.exe' },
	{ key: 'terminal.integrated.fontSize', title: 'Terminal: Font Size', description: 'Ukuran font terminal dalam piksel.', category: 'Terminal', type: 'number', defaultValue: 13, minimum: 8, maximum: 32 },
	{ key: 'terminal.integrated.cursorBlinking', title: 'Terminal: Cursor Blinking', description: 'Aktifkan kedipan kursor terminal.', category: 'Terminal', type: 'boolean', defaultValue: true },
	{ key: 'terminal.integrated.scrollback', title: 'Terminal: Scrollback Limit', description: 'Jumlah baris buffer terminal maksimum.', category: 'Terminal', type: 'number', defaultValue: 1000, minimum: 100, maximum: 50000 },
	{ key: 'search.exclude', title: 'Search: Exclude', description: 'Glob pola folder yang dikecualikan dari pencarian.', category: 'Search', type: 'string', defaultValue: 'node_modules, dist, .git' },
	{ key: 'search.useRipgrep', title: 'Search: Use Ripgrep', description: 'Gunakan binary ripgrep asli untuk pencarian.', category: 'Search', type: 'boolean', defaultValue: true },
	{ key: 'files.exclude', title: 'Files: Exclude', description: 'Pola nama file yang disembunyikan di explorer.', category: 'Files', type: 'string', defaultValue: '**/.git, **/node_modules' },
	{ key: 'files.autoSave', title: 'Files: Auto Save', description: 'Kontrol auto-save file yang tidak disimpan.', category: 'Files', type: 'enum', defaultValue: 'off', options: [{ label: 'Off', value: 'off' }, { label: 'After Delay', value: 'afterDelay' }, { label: 'On Focus Change', value: 'onFocusChange' }, { label: 'On Window Change', value: 'onWindowChange' }] },
	{ key: 'git.enabled', title: 'Git: Enabled', description: 'Aktifkan integrasi Git.', category: 'Git', type: 'boolean', defaultValue: true },
	{ key: 'git.autofetch', title: 'Git: Auto Fetch', description: 'Ambil perubahan remote secara otomatis.', category: 'Git', type: 'boolean', defaultValue: false },
	{ key: 'debug.console.fontSize', title: 'Debug: Console Font Size', description: 'Ukuran font debug console.', category: 'Debug', type: 'number', defaultValue: 13, minimum: 8, maximum: 32 },
	{ key: 'debug.showBreakpointsInGutter', title: 'Debug: Show Breakpoints in Gutter', description: 'Tampilkan breakpoint di gutter editor.', category: 'Debug', type: 'boolean', defaultValue: true }
];

const SETTINGS_STYLE_ID = 'dc-settings-editor-styles';

export class SettingsEditor extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _sidebar: HTMLElement;
	private readonly _content: HTMLElement;
	private readonly _searchInput: HTMLInputElement;
	private readonly _search: SettingsSearch;
	private readonly _configurationService: IConfigurationService;
	private _activeCategory = 'All';
	private _query = '';

	constructor(parentDom: HTMLElement, configurationService?: IConfigurationService, search?: SettingsSearch) {
		super();
		this._configurationService = configurationService ?? new ConfigurationService();
		this._search = search ?? new SettingsSearch();

		CssInjector.inject(SETTINGS_STYLE_ID, `
			.dc-settings-category { padding: 6px 12px; cursor: pointer; font-size: 12px; color: #cccccc; user-select: none; }
			.dc-settings-category:hover { background: #2a2d2e; }
			.dc-settings-category.active { background: #37373d; color: #ffffff; }
			.dc-settings-row { display: grid; grid-template-columns: 1fr 280px; gap: 16px; padding: 10px 16px; align-items: center; border-bottom: 1px solid #2a2d2e; }
			.dc-settings-row:hover { background: #2a2d2e; }
			.dc-settings-control { width: 100%; box-sizing: border-box; }
		`);

		this._container = $<HTMLElement>('div', 'dc-settings-editor');
		this._container.style.cssText = 'display:flex;height:100%;overflow:hidden;background:#1e1e1e;';

		this._sidebar = $<HTMLElement>('div', 'dc-settings-sidebar');
		this._sidebar.style.cssText = 'width:180px;background:#252526;overflow-y:auto;border-right:1px solid #2a2d2e;flex-shrink:0;';
		this._container.appendChild(this._sidebar);

		const contentWrapper = $<HTMLElement>('div');
		contentWrapper.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

		const searchRow = $<HTMLElement>('div');
		searchRow.style.cssText = 'padding:12px 16px;border-bottom:1px solid #2a2d2e;';
		this._searchInput = $<HTMLInputElement>('input');
		this._searchInput.placeholder = 'Cari pengaturan (mis. "font")';
		this._searchInput.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:13px;padding:5px 10px;outline:none;';
		searchRow.appendChild(this._searchInput);
		contentWrapper.appendChild(searchRow);

		this._content = $<HTMLElement>('div', 'dc-settings-content');
		this._content.style.cssText = 'flex:1;overflow-y:auto;';
		contentWrapper.appendChild(this._content);
		this._container.appendChild(contentWrapper);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._searchInput, 'input', () => {
			this._query = this._searchInput.value;
			this._renderContent();
		}));
		this._renderSidebar();
		this._renderContent();
	}

	public setCategory(category: string): void {
		this._activeCategory = category;
		this._renderSidebar();
		this._renderContent();
	}

	public setQuery(query: string): void {
		this._searchInput.value = query;
		this._query = query;
		this._renderContent();
	}

	private _renderSidebar(): void {
		clearNode(this._sidebar);
		const allCategories: string[] = ['All', ...SETTINGS_CATEGORIES];
		for (const category of allCategories) {
			const item = $<HTMLElement>('div', 'dc-settings-category' + (category === this._activeCategory ? ' active' : ''));
			item.textContent = category;
			item.addEventListener('click', () => {
				this.setCategory(category);
			});
			this._sidebar.appendChild(item);
		}
	}

	private _getFilteredSettings(): ISettingDescriptor[] {
		let settings = DEFAULT_SETTINGS;
		if (this._query) {
			settings = this._search.filter(this._query, settings);
		}
		if (this._activeCategory !== 'All') {
			settings = settings.filter(s => s.category === this._activeCategory);
		}
		return settings;
	}

	private _renderContent(): void {
		clearNode(this._content);
		const settings = this._getFilteredSettings();

		if (settings.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada pengaturan yang cocok';
			empty.style.cssText = 'padding:16px;color:#8a8a8a;font-size:13px;';
			this._content.appendChild(empty);
			return;
		}

		let lastCategory = '';
		for (const setting of settings) {
			if (setting.category !== lastCategory) {
				lastCategory = setting.category;
				const group = $<HTMLElement>('div', 'dc-settings-group-title');
				group.textContent = setting.category.toUpperCase();
				group.style.cssText = 'text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:600;color:#bbbbbb;padding:12px 16px 4px;background:#1e1e1e;';
				this._content.appendChild(group);
			}
			this._renderRow(setting);
		}
	}

	private _renderRow(setting: ISettingDescriptor): void {
		const row = $<HTMLElement>('div', 'dc-settings-row');
		row.dataset['settingKey'] = setting.key;

		const labelSide = $<HTMLElement>('div');
		const title = $<HTMLElement>('div');
		title.textContent = setting.title;
		title.style.cssText = 'font-size:13px;color:#cccccc;font-weight:600;';
		const description = $<HTMLElement>('div');
		description.textContent = setting.description;
		description.style.cssText = 'font-size:12px;color:#8a8a8a;margin-top:2px;';
		const keyLabel = $<HTMLElement>('div');
		keyLabel.textContent = setting.key;
		keyLabel.style.cssText = 'font-size:11px;color:#6a6a6a;margin-top:2px;';
		labelSide.appendChild(title);
		labelSide.appendChild(description);
		labelSide.appendChild(keyLabel);

		const controlSide = $<HTMLElement>('div', 'dc-settings-control');
		const currentValue = this._configurationService.getValue<any>(setting.key);
		const value = currentValue !== undefined ? currentValue : setting.defaultValue;

		const onUpdate = (newValue: any): void => {
			void this._configurationService.updateValue(setting.key, newValue);
		};

		if (setting.type === 'boolean') {
			const checkbox = $<HTMLInputElement>('input', 'dc-settings-checkbox');
			checkbox.type = 'checkbox';
			checkbox.checked = !!value;
			checkbox.style.cssText = 'accent-color:#007fd4;width:16px;height:16px;';
			checkbox.addEventListener('change', () => onUpdate(checkbox.checked));
			controlSide.appendChild(checkbox);
		} else if (setting.type === 'number') {
			const input = $<HTMLInputElement>('input', 'dc-settings-number');
			input.type = 'number';
			input.value = String(value);
			input.min = String(setting.minimum ?? 0);
			input.max = String(setting.maximum ?? 100);
			input.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:1px solid #3c3c3c;border-radius:2px;color:#cccccc;font-size:13px;padding:4px 8px;outline:none;';
			input.addEventListener('change', () => {
				const num = parseFloat(input.value);
				if (!isNaN(num)) {
					onUpdate(num);
				}
			});
			controlSide.appendChild(input);
		} else if (setting.type === 'enum') {
			const select = $<HTMLSelectElement>('select', 'dc-settings-select');
			for (const option of setting.options ?? []) {
				const opt = document.createElement('option');
				opt.value = option.value;
				opt.textContent = option.label;
				opt.selected = option.value === value;
				select.appendChild(opt);
			}
			select.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:1px solid #3c3c3c;border-radius:2px;color:#cccccc;font-size:13px;padding:4px 8px;outline:none;';
			select.addEventListener('change', () => onUpdate(select.value));
			controlSide.appendChild(select);
		} else {
			const input = $<HTMLInputElement>('input', 'dc-settings-text');
			input.type = 'text';
			input.value = String(value ?? '');
			input.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:1px solid #3c3c3c;border-radius:2px;color:#cccccc;font-size:13px;padding:4px 8px;outline:none;';
			input.addEventListener('change', () => onUpdate(input.value));
			controlSide.appendChild(input);
		}

		row.appendChild(labelSide);
		row.appendChild(controlSide);
		this._content.appendChild(row);
	}
}
