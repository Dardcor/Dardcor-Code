/**
 * Dardcor Code - Variable Scope Inspection Tree View Component
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode } from '../../core/dom/element.js';
import { DebugSession, IDebugVariable, DebugState } from './debug-session.js';

export interface IVariablesViewNode {
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly variablesReference: number;
	readonly expanded: boolean;
	readonly children?: IVariablesViewNode[];
}

export class VariablesView extends Disposable {
	private readonly _onDidSelectVariable = this._register(new Emitter<IDebugVariable>());
	readonly onDidSelectVariable: Event<IDebugVariable> = this._onDidSelectVariable.event;

	private readonly _container: HTMLElement;
	private readonly _rootNodes = new Map<number, IVariablesViewNode[]>();
	private readonly _expandedReferences = new Set<number>();

	constructor(parentDom: HTMLElement, private readonly _session: DebugSession) {
		super();
		this._container = $<HTMLElement>('div', 'dc-variables-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
		parentDom.appendChild(this._container);

		this._register(this._session.onDidStop(() => this.refresh()));
		this._register(this._session.onDidChangeState(state => {
			if (state === DebugState.Exited || state === DebugState.Idle) {
				this.clear();
			}
		}));
	}

	public async refresh(): Promise<void> {
		const frameId = this._session.currentFrameId;
		if (frameId === undefined) {
			this.clear();
			return;
		}
		try {
			const scopes = await this._session.getScopes(frameId);
			this._rootNodes.clear();
			for (const scope of scopes) {
				this._rootNodes.set(scope.variablesReference, [{ name: scope.name, value: '', type: 'scope', variablesReference: scope.variablesReference, expanded: false }]);
			}
			this._render();
		} catch {
			this.clear();
		}
	}

	public clear(): void {
		this._rootNodes.clear();
		this._render();
	}

	private async _render(): Promise<void> {
		clearNode(this._container);
		const title = $<HTMLElement>('div', 'dc-variables-title');
		title.textContent = 'VARIABLES';
		title.style.cssText = 'text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:600;color:#bbbbbb;padding:8px 12px 4px;user-select:none;';
		this._container.appendChild(title);

		if (this._rootNodes.size === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada variabel';
			empty.style.cssText = 'padding:4px 12px;color:#8a8a8a;font-size:12px;';
			this._container.appendChild(empty);
			return;
		}

		for (const [ref, nodes] of this._rootNodes) {
			await this._renderScope(ref, nodes);
		}
	}

	private async _renderScope(ref: number, nodes: IVariablesViewNode[]): Promise<void> {
		for (const node of nodes) {
			if (node.variablesReference > 0) {
				const row = this._renderVariableRow(node, 0, true);
				this._container.appendChild(row);
				if (this._expandedReferences.has(node.variablesReference)) {
					const children = await this._loadChildren(node.variablesReference);
					for (const child of children) {
						this._container.appendChild(this._renderVariableRow(child, 1, false));
					}
				}
			}
		}
	}

	private _renderVariableRow(variable: IVariablesViewNode, depth: number, isScope: boolean): HTMLElement {
		const row = $<HTMLElement>('div', 'dc-variable-row');
		row.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:2px 12px;cursor:pointer;font-size:12px;user-select:none;';
		row.style.paddingLeft = `${12 + depth * 14}px`;
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});

		const chevron = $<HTMLElement>('span');
		chevron.textContent = this._expandedReferences.has(variable.variablesReference) ? '\u25BE' : '\u25B8';
		chevron.style.cssText = 'font-size:9px;width:12px;color:#cccccc;';

		const name = $<HTMLElement>('span');
		name.textContent = variable.name;
		name.style.cssText = 'color:#9cdcfe;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%;';

		const value = $<HTMLElement>('span');
		value.textContent = variable.value || '(tidak ada)';
		value.style.cssText = 'color:#ce9178;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
		if (isScope) {
			value.style.color = '#cccccc';
		}

		row.appendChild(chevron);
		row.appendChild(name);
		row.appendChild(value);

		if (variable.variablesReference > 0) {
			row.addEventListener('click', async () => {
				const ref = variable.variablesReference;
				if (this._expandedReferences.has(ref)) {
					this._expandedReferences.delete(ref);
				} else {
					this._expandedReferences.add(ref);
				}
				await this._render();
			});
		} else {
			row.addEventListener('click', () => {
				this._onDidSelectVariable.fire({ name: variable.name, value: variable.value, variablesReference: 0 });
			});
		}
		return row;
	}

	private async _loadChildren(variablesReference: number): Promise<IVariablesViewNode[]> {
		const cached = this._rootNodes.get(variablesReference);
		if (cached && cached.length > 0) {
			return cached;
		}
		try {
			const variables = await this._session.getVariables(variablesReference);
			const nodes = variables.map(v => ({
				name: v.name,
				value: v.value,
				type: v.type,
				variablesReference: v.variablesReference,
				expanded: false
			}));
			this._rootNodes.set(variablesReference, nodes);
			return nodes;
		} catch {
			return [];
		}
	}
}
