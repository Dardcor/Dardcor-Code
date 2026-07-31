/**
 * Dardcor Code - DAP Debugger Viewlet Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { DebugSession, DebugState, IStackFrame, IDebugSessionOptions } from './debug-session';
import { BreakpointManager, IBreakpoint } from './breakpoint-manager';
import { CallStackView } from './call-stack-view';
import { VariablesView } from './variables-view';
import { WatchView } from './watch-view';
import { DebugToolbar } from './debug-toolbar';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';

const DEBUG_STYLE_ID = 'dc-debug-viewlet-styles';

const DEBUG_STATE_LABELS: Record<number, string> = {
	[DebugState.Idle]: 'Idle',
	[DebugState.Initializing]: 'Initializing',
	[DebugState.Running]: 'Running',
	[DebugState.Stopped]: 'Paused',
	[DebugState.Paused]: 'Paused',
	[DebugState.Exited]: 'Exited'
};

export interface IDebugViewletOptions {
	session?: DebugSession;
	breakpointManager?: BreakpointManager;
	launchOptions?: IDebugSessionOptions;
	rootPath?: string;
}

export class DebugViewlet extends Disposable {
	private readonly _onDidSelectFrame = this._register(new Emitter<IStackFrame>());
	readonly onDidSelectFrame: Event<IStackFrame> = this._onDidSelectFrame.event;

	private readonly _onDidToggleBreakpoint = this._register(new Emitter<IBreakpoint | undefined>());
	readonly onDidToggleBreakpoint: Event<IBreakpoint | undefined> = this._onDidToggleBreakpoint.event;

	private readonly _onDidOutput = this._register(new Emitter<string>());
	readonly onDidOutput: Event<string> = this._onDidOutput.event;

	private readonly _container: HTMLElement;
	private readonly _session: DebugSession;
	private readonly _breakpoints: BreakpointManager;
	private readonly _toolbar: DebugToolbar;
	private readonly _callStackView: CallStackView;
	private readonly _variablesView: VariablesView;
	private readonly _watchView: WatchView;
	private readonly _breakpointsContainer: HTMLElement;
	private readonly _stateLabel: HTMLElement;
	private readonly _rootPath: string;

	constructor(parentDom: HTMLElement, options: IDebugViewletOptions = {}) {
		super();
		this._session = options.session ?? new DebugSession();
		this._breakpoints = options.breakpointManager ?? new BreakpointManager();
		this._rootPath = options.rootPath ?? (typeof process !== 'undefined' && process.cwd ? process.cwd().replace(/\\/g, '/') : '');

		CssInjector.inject(DEBUG_STYLE_ID, `
			.dc-debug-section-title {
				text-transform: uppercase; letter-spacing: 1px; font-size: 11px; font-weight: 600;
				color: #bbbbbb; padding: 8px 12px 4px; user-select: none;
			}
			.dc-debug-breakpoint-row { display: flex; align-items: center; gap: 6px; padding: 2px 12px; font-size: 12px; color: #cccccc; user-select: none; }
			.dc-debug-breakpoint-row:hover { background: #2a2d2e; }
		`);

		this._container = $<HTMLElement>('div', 'dc-debug-viewlet');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		const header = $<HTMLElement>('div');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2d2e;';
		const title = $<HTMLElement>('span');
		title.textContent = 'RUN AND DEBUG';
		title.style.cssText = 'font-weight:bold;font-size:12px;color:#cccccc;flex:1;letter-spacing:0.5px;';
		this._stateLabel = $<HTMLElement>('span', 'dc-debug-state');
		this._stateLabel.textContent = 'Idle';
		this._stateLabel.style.cssText = 'font-size:11px;color:#8a8a8a;';
		header.appendChild(title);
		header.appendChild(this._stateLabel);
		this._container.appendChild(header);

		const launchRow = $<HTMLElement>('div');
		launchRow.style.cssText = 'display:flex;gap:4px;padding:6px 12px;align-items:center;';
		const launchButton = $<HTMLButtonElement>('button');
		launchButton.textContent = '\u25B6 Start Debugging';
		launchButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:4px 10px;font-size:12px;cursor:pointer;flex:1;';
		launchRow.appendChild(launchButton);
		this._container.appendChild(launchRow);

		this._breakpointsContainer = $<HTMLElement>('div', 'dc-debug-breakpoints');
		this._breakpointsContainer.style.cssText = 'border-bottom:1px solid #2a2d2e;max-height:160px;overflow-y:auto;';
		this._container.appendChild(this._breakpointsContainer);

		const watchWrapper = $<HTMLElement>('div');
		watchWrapper.style.cssText = 'border-bottom:1px solid #2a2d2e;';
		this._watchView = new WatchView(watchWrapper, this._session);
		this._container.appendChild(watchWrapper);

		const variablesWrapper = $<HTMLElement>('div');
		variablesWrapper.style.cssText = 'flex:1;min-height:80px;overflow:hidden;';
		this._variablesView = new VariablesView(variablesWrapper, this._session);
		this._container.appendChild(variablesWrapper);

		const callStackWrapper = $<HTMLElement>('div');
		callStackWrapper.style.cssText = 'border-top:1px solid #2a2d2e;max-height:200px;overflow:hidden;';
		this._callStackView = new CallStackView(callStackWrapper, this._session);
		this._container.appendChild(callStackWrapper);

		parentDom.appendChild(this._container);

		this._toolbar = new DebugToolbar(parentDom, this._session);
		this._toolbar.show(80, 40);

		this._register(addDisposableListener(launchButton, 'click', () => {
			this.startDebugging();
		}));
		this._register(this._session.onDidChangeState(state => {
			this._stateLabel.textContent = DEBUG_STATE_LABELS[state] ?? 'Idle';
			this._stateLabel.style.color = state === DebugState.Exited ? '#f14c4c' : '#8a8a8a';
			this._renderBreakpoints();
			if (state === DebugState.Exited || state === DebugState.Idle) {
				this._toolbar.hide();
			} else {
				this._toolbar.show(80, 40);
			}
		}));
		this._register(this._session.onDidStop(() => {
			void this._variablesView.refresh();
			void this._watchView.refreshValues();
		}));
		this._register(this._session.onDidOutput(text => {
			this._onDidOutput.fire(text);
		}));
		this._register(this._session.onDidError(message => {
			this._stateLabel.textContent = message;
			this._stateLabel.style.color = '#f14c4c';
		}));
		this._register(this._callStackView.onDidSelectFrame(frame => {
			this._onDidSelectFrame.fire(frame);
		}));
		this._register(this._breakpoints.onDidChange(() => this._renderBreakpoints()));

		this._renderBreakpoints();
	}

	get session(): DebugSession {
		return this._session;
	}

	get breakpointManager(): BreakpointManager {
		return this._breakpoints;
	}

	public async startDebugging(options?: IDebugSessionOptions): Promise<void> {
		const launchOptions = options ?? this._lastLaunchOptions;
		if (!launchOptions) {
			this._stateLabel.textContent = 'Konfigurasi launch tidak tersedia';
			return;
		}
		this._lastLaunchOptions = launchOptions;
		this._toolbar.show(80, 40);
		await this._session.start(launchOptions, this._breakpoints.getBreakpoints());
		await this._variablesView.refresh();
	}

	public async toggleBreakpoint(resource: URI, line: number): Promise<void> {
		const bp = this._breakpoints.toggle(resource, line);
		if (bp && (this._session.state === DebugState.Running || this._session.state === DebugState.Stopped)) {
			await this._session.setBreakpoints(this._breakpoints.getBreakpoints());
		}
		this._onDidToggleBreakpoint.fire(bp);
	}

	private _lastLaunchOptions: IDebugSessionOptions | undefined;

	public setLaunchOptions(options: IDebugSessionOptions): void {
		this._lastLaunchOptions = options;
	}

	private _renderBreakpoints(): void {
		clearNode(this._breakpointsContainer);
		const title = $<HTMLElement>('div', 'dc-debug-section-title');
		title.textContent = 'BREAKPOINTS';
		this._breakpointsContainer.appendChild(title);

		const all = this._breakpoints.getBreakpoints();
		if (all.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada breakpoint';
			empty.style.cssText = 'padding:2px 12px;color:#8a8a8a;font-size:12px;';
			this._breakpointsContainer.appendChild(empty);
			return;
		}
		for (const bp of all) {
			const row = $<HTMLElement>('div', 'dc-debug-breakpoint-row');
			const icon = $<HTMLElement>('span');
			icon.textContent = '\u25C9';
			icon.style.cssText = `color:${bp.enabled ? '#f14c4c' : '#6a6a6a'};font-size:11px;`;
			const name = $<HTMLElement>('span');
			name.textContent = `${Path.basename(bp.resource.path)}:${bp.line}`;
			name.style.color = bp.enabled ? '#cccccc' : '#8a8a8a';
			const remove = $<HTMLButtonElement>('button');
			remove.textContent = '\u2716';
			remove.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:10px;margin-left:auto;';
			remove.addEventListener('click', () => {
				this._breakpoints.remove(bp.resource, bp.line);
			});
			row.appendChild(icon);
			row.appendChild(name);
			row.appendChild(remove);
			this._breakpointsContainer.appendChild(row);
		}
	}
}
