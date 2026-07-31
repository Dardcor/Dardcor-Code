/**
 * Dardcor Code - Page Object Model Classes for Playwright E2E UI Automation (Task 932)
 *
 * Page objects for the workbench UI (editor, explorer, terminal, command
 * palette, settings, status bar). Types are structural (`any`-based) so the
 * file compiles WITHOUT installing `@playwright/test` - the objects operate
 * on a minimal Page/Locator surface used by Playwright.
 */

// Structural stand-ins so this file typechecks standalone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Locator = any;

export interface PageObjectOptions {
	readonly page: Page;
	readonly baseURL?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class BasePage {
	protected readonly page: Page;
	protected readonly baseURL: string;

	constructor(options: PageObjectOptions) {
		this.page = options.page;
		this.baseURL = options.baseURL ?? '';
	}

	async goto(path: string): Promise<void> {
		await this.page.goto(`${this.baseURL}${path}`);
	}

	/** Waits for the workbench shell (title bar / editor container) to appear. */
	async waitForWorkbench(timeoutMs = 15000): Promise<void> {
		await this.page.locator('#dc-workbench, .monaco-editor, [data-dc-workbench]').first().waitFor({ state: 'visible', timeout: timeoutMs });
	}

	protected locator(selector: string): Locator {
		return this.page.locator(selector);
	}

	async screenshot(name: string): Promise<void> {
		await this.page.screenshot({ path: name });
	}
}

export class EditorPage extends BasePage {
	private readonly _editorSelector = '[data-dc-editor], .monaco-editor, .dc-editor';

	async openFile(fileName: string): Promise<void> {
		await this.page.locator(`[data-dc-tab="${fileName}"], [title*="${fileName}"]`).first().click();
		await this.waitForEditor();
	}

	async waitForEditor(): Promise<void> {
		await this.locator(this._editorSelector).first().waitFor({ state: 'visible' });
	}

	async type(text: string): Promise<void> {
		const editor = this.locator(this._editorSelector).first();
		await editor.click();
		await editor.pressSequentially(text, { delay: 5 });
	}

	async press(key: string): Promise<void> {
		await this.locator(this._editorSelector).first().press(key);
	}

	async selectAll(): Promise<void> {
		await this.page.keyboard.press('ControlOrMeta+a');
	}

	async getLineText(line: number): Promise<string> {
		const text = await this.locator(`[data-dc-line="${line}"]`).textContent();
		return text ?? '';
	}

	async getEditorText(): Promise<string> {
		return (await this.locator(this._editorSelector).textContent()) ?? '';
	}

	async getCursorPosition(): Promise<{ line: number; character: number }> {
		const statusText = await this.page.locator('[data-dc-status-cursor], .cursor-status').textContent();
		const match = /Ln\s*(\d+),\s*Col\s*(\d+)/.exec(statusText ?? '');
		return match ? { line: Number(match[1]), character: Number(match[2]) } : { line: 1, character: 1 };
	}

	async findInEditor(text: string): Promise<number> {
		const content = await this.getEditorText();
		return content.indexOf(text);
	}
}

export class ExplorerPage extends BasePage {
	private readonly _treeSelector = '[data-dc-explorer-tree], .explorer-viewlet';

	async open(): Promise<void> {
		await this.page.locator('[data-dc-activity="explorer"], [title="Explorer"], [aria-label="Explorer"]').first().click();
		await this.locator(this._treeSelector).first().waitFor({ state: 'visible' });
	}

	async openFolder(path: string): Promise<void> {
		await this.open();
		await this.page.locator('[data-dc-open-folder], [title="Open Folder"]').first().click();
		if (this.page.evaluate) {
			await this.page.evaluate(async (folderPath: string) => {
				// The app exposes a test hook when running under Playwright.
				const hook = (window as any).__dcTest?.openFolder;
				if (hook) await hook(folderPath);
			}, path);
		}
		await delay(500);
	}

	async createFile(name: string, content = ''): Promise<void> {
		await this.page.locator('[data-dc-new-file], [title="New File"]').first().click();
		const input = this.page.locator('[data-dc-filename-input]');
		await input.waitFor({ state: 'visible' });
		await input.fill(name);
		await input.press('Enter');
		if (content) {
			await this.page.locator('[data-dc-editor]').first().click();
			await this.page.keyboard.press('ControlOrMeta+a');
			await this.page.keyboard.type(content);
		}
	}

	async deleteFile(name: string): Promise<void> {
		const node = this.locator(this._treeSelector).getByText(name, { exact: true });
		await node.click({ button: 'right' });
		await this.page.getByText('Delete', { exact: true }).first().click();
		await this.page.getByRole('button', { name: /Delete|Yes/ }).first().click();
	}

	async getFileTree(): Promise<string> {
		return (await this.locator(this._treeSelector).textContent()) ?? '';
	}
}

export class TerminalPage extends BasePage {
	private readonly _terminalSelector = '[data-dc-terminal], .terminal';

	async open(): Promise<void> {
		await this.page.locator('[data-dc-panel-tab="Terminal"], [title="Terminal"]').first().click();
		await this.locator(this._terminalSelector).first().waitFor({ state: 'visible' });
	}

	async runCommand(command: string): Promise<void> {
		const terminal = this.locator(this._terminalSelector).first();
		await terminal.click();
		await terminal.pressSequentially(command, { delay: 2 });
		await terminal.press('Enter');
		await delay(500);
	}

	async readOutput(): Promise<string> {
		return (await this.locator(this._terminalSelector).textContent()) ?? '';
	}

	async clear(): Promise<void> {
		await this.page.keyboard.press('ControlOrMeta+k');
	}
}

export class CommandPalettePage extends BasePage {
	async open(): Promise<void> {
		await this.page.keyboard.press('ControlOrMeta+Shift+p');
		await this.locator('[data-dc-quickinput], .quick-input-widget').first().waitFor({ state: 'visible' });
	}

	async search(text: string): Promise<void> {
		await this.locator('[data-dc-quickinput] input, .quick-input-box input').first().fill(text);
	}

	async runCommand(commandId: string): Promise<void> {
		await this.open();
		await this.search(commandId);
		await this.page.keyboard.press('Enter');
	}

	async getSuggestions(): Promise<string[]> {
		const items = this.page.locator('[data-dc-quickinput-item], .quick-input-list .monaco-list-row');
		const count = await items.count();
		const result: string[] = [];
		for (let i = 0; i < Math.min(count, 20); i++) {
			result.push((await items.nth(i).textContent()) ?? '');
		}
		return result;
	}
}

export class SettingsPage extends BasePage {
	async open(): Promise<void> {
		const palette = new CommandPalettePage({ page: this.page, baseURL: this.baseURL });
		await palette.runCommand('Preferences: Open Settings');
		await this.locator('[data-dc-settings-editor]').first().waitFor({ state: 'visible' });
	}

	async setSetting(id: string, value: string): Promise<void> {
		const search = this.locator('[data-dc-settings-search] input, .settings-search input');
		await search.fill(id);
		await delay(300);
		const input = this.page.locator(`[data-dc-setting="${id}"] input, [data-settings-setting="${id}"] input`).first();
		await input.fill(value);
		await input.blur();
	}

	async getSettingValue(id: string): Promise<string> {
		const input = this.page.locator(`[data-dc-setting="${id}"] input, [data-settings-setting="${id}"] input`).first();
		return (await input.inputValue()) ?? '';
	}
}

export class StatusBarPage extends BasePage {
	async getItem(id: string): Promise<string> {
		return (await this.page.locator(`[data-dc-status-item="${id}"]`).textContent()) ?? '';
	}

	async hasErrorIndicator(): Promise<boolean> {
		return (await this.page.locator('[data-dc-status-errors]').textContent())?.includes('0 errors') === false;
	}
}

export class WorkbenchApp extends BasePage {
	readonly editor: EditorPage;
	readonly explorer: ExplorerPage;
	readonly terminal: TerminalPage;
	readonly commandPalette: CommandPalettePage;
	readonly settings: SettingsPage;
	readonly statusBar: StatusBarPage;

	constructor(options: PageObjectOptions) {
		super(options);
		this.editor = new EditorPage(options);
		this.explorer = new ExplorerPage(options);
		this.terminal = new TerminalPage(options);
		this.commandPalette = new CommandPalettePage(options);
		this.settings = new SettingsPage(options);
		this.statusBar = new StatusBarPage(options);
	}

	async launch(path = '/'): Promise<void> {
		await this.goto(path);
		await this.waitForWorkbench();
	}
}
