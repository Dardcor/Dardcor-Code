/**
 * Dardcor Code - Integrated Terminal Panel View Container
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { TerminalEmulator, XtermRenderer } from './xterm-integration.js';
import { TerminalProcess, ITerminalProcessOptions } from './terminal-process.js';
import { TerminalTabs } from './terminal-tabs.js';
import { IConfigurationService, ConfigurationService } from '../../services/configuration/configuration-service.js';

export interface ITerminalInstance {
	readonly id: number;
	readonly process: TerminalProcess;
	readonly emulator: TerminalEmulator;
	readonly renderer: XtermRenderer;
	readonly view: HTMLElement;
}

export class TerminalView extends Disposable {
	private readonly _onDidChangeActiveInstance = this._register(new Emitter<ITerminalInstance | undefined>());
	readonly onDidChangeActiveInstance: Event<ITerminalInstance | undefined> = this._onDidChangeActiveInstance.event;

	private readonly _onDidCloseInstance = this._register(new Emitter<ITerminalInstance>());
	readonly onDidCloseInstance: Event<ITerminalInstance> = this._onDidCloseInstance.event;

	private readonly _container: HTMLElement;
	private readonly _tabs: TerminalTabs;
	private readonly _contentContainer: HTMLElement;
	private readonly _instances = new Map<number, ITerminalInstance>();
	private readonly _configurationService: IConfigurationService;

	constructor(parentDom: HTMLElement, configurationService?: IConfigurationService) {
		super();
		this._configurationService = configurationService ?? new ConfigurationService();

		this._container = $<HTMLElement>('div', 'dc-terminal-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		this._tabs = new TerminalTabs(this._container);

		this._contentContainer = $<HTMLElement>('div', 'dc-terminal-content');
		this._contentContainer.style.cssText = 'flex:1;overflow:hidden;position:relative;';
		this._container.appendChild(this._contentContainer);
		parentDom.appendChild(this._container);

		this._register(this._tabs.onDidChangeActiveTab(id => {
			this._showInstance(id);
		}));
		this._register(this._tabs.onDidCloseTab(id => {
			const instance = this._instances.get(id);
			if (instance) {
				instance.process.kill();
				instance.view.remove();
				this._instances.delete(id);
				this._onDidCloseInstance.fire(instance);
			}
		}));
		this._register(this._tabs.onDidRequestNewTab(() => {
			this.createInstance();
		}));
	}

	get activeInstance(): ITerminalInstance | undefined {
		const id = this._tabs.activeTabId;
		return id >= 0 ? this._instances.get(id) : undefined;
	}

	get instances(): ITerminalInstance[] {
		return [...this._instances.values()];
	}

	public createInstance(options: ITerminalProcessOptions = {}): ITerminalInstance {
		const emulator = new TerminalEmulator(80, 24);
		const process = new TerminalProcess(80, 24, this._configurationService);

		const view = $<HTMLElement>('div', 'dc-terminal-instance');
		view.style.cssText = 'position:absolute;inset:0;display:none;background:#1e1e1e;';
		view.tabIndex = 0;
		view.style.outline = 'none';

		const renderer = new XtermRenderer(view, emulator);
		renderer.startBlink();

		const id = this._instances.size + 1;
		const instance: ITerminalInstance = { id, process, emulator, renderer, view };

		this._register(process.onData(data => {
			emulator.write(data);
			renderer.render();
		}));
		this._register(process.onExit(() => {
			emulator.write('\r\n\x1b[1m[Proses selesai - klik untuk menutup]\x1b[0m\r\n');
			renderer.render();
		}));
		this._register(process.onError(message => {
			emulator.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
			renderer.render();
		}));
		this._register(addDisposableListener(view, 'keydown', (e) => {
			const kd = e as KeyboardEvent;
			if (kd.ctrlKey || kd.metaKey) {
				if (kd.key === 'c') {
					process.write('\x03');
					e.preventDefault();
					return;
				}
				if (kd.key === 'l') {
					emulator.write('\x0c');
					e.preventDefault();
					return;
				}
			}
			if (kd.key === 'Enter') {
				process.write('\r');
			} else if (kd.key === 'Backspace') {
				process.write('\x7f');
			} else if (kd.key === 'Tab') {
				process.write('\t');
			} else if (kd.key.length === 1) {
				process.write(kd.key);
			}
			e.preventDefault();
		}));

		this._instances.set(id, instance);
		this._contentContainer.appendChild(view);
		this._tabs.addTab(options.shell ?? 'Terminal');
		this._showInstance(id);
		process.start(options);
		view.focus();
		return instance;
	}

	public closeInstance(id: number): void {
		this._tabs.removeTab(id);
	}

	public setActiveInstance(id: number): void {
		this._tabs.setActive(id);
	}

	private _showInstance(id: number): void {
		for (const [key, instance] of this._instances) {
			instance.view.style.display = key === id ? 'block' : 'none';
		}
		const active = this._instances.get(id);
		this._onDidChangeActiveInstance.fire(active);
	}

	public clear(): void {
		for (const instance of this._instances.values()) {
			instance.process.kill();
		}
		this._instances.clear();
		this._tabs.clear();
		clearNode(this._contentContainer);
	}
}
