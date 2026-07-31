/**
 * Dardcor Code - Status Bar Document Language Mode Selector
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { URI } from '../../../core/types/uri.js';
import { Path } from '../../../core/types/path.js';
import { QuickPickItem } from '../../quickinput/quick-pick-item.js';
import { IQuickInputService } from '../../quickinput/quick-input-service.js';
import { EditorInput } from './editor-input.js';
import { IStatusbarEntry, StatusbarRegistry } from '../statusbar/statusbar-registry.js';
import { CommandRegistry } from '../../../services/commands/command-service.js';

export interface ILanguageDescriptor {
	readonly id: string;
	readonly label: string;
	readonly extensions: string[];
	readonly icon?: string;
}

export interface ILanguageChangeEvent {
	readonly input: EditorInput;
	readonly from: string;
	readonly to: string;
}

export const PLAIN_TEXT_LANGUAGE: ILanguageDescriptor = {
	id: 'plaintext',
	label: 'Plain Text',
	extensions: ['.txt', '.log', '.csv', '.ini', '.cfg', '.bat', '.cmd'],
	icon: '\u270e',
};

export const LANGUAGE_REGISTRY: ILanguageDescriptor[] = [
	{ id: 'typescript', label: 'TypeScript', extensions: ['.ts', '.mts', '.cts'], icon: '\u1F4D8' },
	{ id: 'typescriptreact', label: 'TypeScript React', extensions: ['.tsx'], icon: '\u1F4D8' },
	{ id: 'javascript', label: 'JavaScript', extensions: ['.js', '.mjs', '.cjs'], icon: '\u1F7E1' },
	{ id: 'javascriptreact', label: 'JavaScript React', extensions: ['.jsx'], icon: '\u1F7E1' },
	{ id: 'json', label: 'JSON', extensions: ['.json', '.jsonc'], icon: '\u1F4E6' },
	{ id: 'html', label: 'HTML', extensions: ['.html', '.htm'], icon: '\u1F5C4' },
	{ id: 'css', label: 'CSS', extensions: ['.css', '.scss', '.less'], icon: '\u1F3A8' },
	{ id: 'markdown', label: 'Markdown', extensions: ['.md', '.markdown'], icon: '\u1F4C4' },
	{ id: 'python', label: 'Python', extensions: ['.py', '.pyw'], icon: '\u1F40D' },
	{ id: 'cpp', label: 'C++', extensions: ['.cpp', '.hpp', '.cc', '.h'], icon: '\u1F4DB' },
	{ id: 'c', label: 'C', extensions: ['.c'], icon: '\u1F4DB' },
	{ id: 'rust', label: 'Rust', extensions: ['.rs'], icon: '\u1F49C' },
	{ id: 'go', label: 'Go', extensions: ['.go'], icon: '\u1F433' },
	{ id: 'java', label: 'Java', extensions: ['.java'], icon: '\u2615' },
	{ id: 'xml', label: 'XML', extensions: ['.xml', '.svg'], icon: '\u2744' },
	{ id: 'yaml', label: 'YAML', extensions: ['.yml', '.yaml'], icon: '\u2699' },
	{ id: 'shell', label: 'Shell Script', extensions: ['.sh', '.bash', '.zsh'], icon: '\u2318' },
	{ id: 'powershell', label: 'PowerShell', extensions: ['.ps1', '.psm1'], icon: '\u25a0' },
	PLAIN_TEXT_LANGUAGE,
];

export class LanguageRegistry extends Disposable {
	private readonly _languages = new Map<string, ILanguageDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor() {
		super();
		for (const language of LANGUAGE_REGISTRY) {
			this.register(language);
		}
	}

	register(language: ILanguageDescriptor): IDisposable {
		this._languages.set(language.id, language);
		this._onDidChange.fire();
		return {
			dispose: () => {
				this._languages.delete(language.id);
				this._onDidChange.fire();
			}
		};
	}

	getLanguage(id: string): ILanguageDescriptor | undefined {
		return this._languages.get(id);
	}

	getLanguages(): ILanguageDescriptor[] {
		return Array.from(this._languages.values());
	}

	detectLanguage(uri: URI): string {
		const ext = Path.extname(uri.path).toLowerCase();
		for (const language of this._languages.values()) {
			if (language.extensions.includes(ext)) {
				return language.id;
			}
		}
		return PLAIN_TEXT_LANGUAGE.id;
	}

	dispose(): void {
		this._languages.clear();
		super.dispose();
	}
}

export class EditorLanguageSelector extends Disposable {
	private readonly _registry: LanguageRegistry;
	private readonly _modes = new Map<string, string>();
	private _statusbarRegistration: IDisposable | null = null;
	private _activeLanguageId: string = PLAIN_TEXT_LANGUAGE.id;

	private readonly _onDidChangeLanguageMode = this._register(new Emitter<ILanguageChangeEvent>());
	readonly onDidChangeLanguageMode: Event<ILanguageChangeEvent> = this._onDidChangeLanguageMode.event;

	constructor(
		private readonly _quickInput: IQuickInputService | null = null,
		private readonly _statusbar: StatusbarRegistry = StatusbarRegistry.instance,
		registry: LanguageRegistry | null = null
	) {
		super();
		this._registry = registry ?? new LanguageRegistry();
		this._register(this._registry);
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.editor.changeLanguageMode',
			handler: () => this.showLanguagePicker(null),
		}));
	}

	get languageRegistry(): LanguageRegistry {
		return this._registry;
	}

	get activeLanguageId(): string {
		return this._activeLanguageId;
	}

	getLanguageModeFor(input: EditorInput): string {
		return this._modes.get(input.toKey()) ?? this._registry.detectLanguage(input.uri);
	}

	setLanguageMode(input: EditorInput, languageId: string): void {
		if (!this._registry.getLanguage(languageId)) {
			return;
		}
		const from = this.getLanguageModeFor(input);
		if (from === languageId) {
			return;
		}
		this._modes.set(input.toKey(), languageId);
		this._activeLanguageId = languageId;
		this._onDidChangeLanguageMode.fire({ input, from, to: languageId });
	}

	resetLanguageMode(input: EditorInput): void {
		const detected = this._registry.detectLanguage(input.uri);
		const from = this.getLanguageModeFor(input);
		this._modes.delete(input.toKey());
		this._activeLanguageId = detected;
		if (from !== detected) {
			this._onDidChangeLanguageMode.fire({ input, from, to: detected });
		}
	}

	createLanguageItems(currentId: string): QuickPickItem[] {
		return this._registry.getLanguages().map(language =>
			new QuickPickItem({
				label: language.label,
				description: language.id === currentId ? 'Current' : undefined,
				detail: language.extensions.map(ext => `*.${ext.substring(1)}`).join('  '),
				icon: language.icon,
				data: language.id,
			})
		);
	}

	async showLanguagePicker(input: EditorInput | null): Promise<string | undefined> {
		if (!this._quickInput) {
			return undefined;
		}
		const current = input ? this.getLanguageModeFor(input) : this._activeLanguageId;
		const picked = await this._quickInput.openQuickPick<QuickPickItem>({
			title: 'Select Language Mode',
			placeholder: 'Set the language mode for the active file',
			items: this.createLanguageItems(current),
		});
		const languageId = picked?.data as string | undefined;
		if (languageId && input) {
			this.setLanguageMode(input, languageId);
		} else if (languageId) {
			this._activeLanguageId = languageId;
		}
		return languageId;
	}

	updateStatusbar(entry: Pick<IStatusbarEntry, 'id' | 'alignment' | 'text' | 'tooltip' | 'commandId' | 'priority' | 'color'>): void {
		this._statusbarRegistration?.dispose();
		const language = this._registry.getLanguage(this._activeLanguageId);
		this._statusbarRegistration = this._statusbar.register({
			...entry,
			text: language?.label ?? this._activeLanguageId,
			tooltip: `Language Mode: ${language?.label ?? this._activeLanguageId}`,
			commandId: 'workbench.action.editor.changeLanguageMode',
			priority: entry.priority ?? 0,
		});
	}

	dispose(): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = null;
		this._modes.clear();
		super.dispose();
	}
}
