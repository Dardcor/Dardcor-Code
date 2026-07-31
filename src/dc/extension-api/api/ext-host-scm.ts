/**
 * Dardcor Code - dc.scm API Bridge (Task 611)
 * Mirrors: vs/workbench/api/common/extHostSCM.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { RPCProtocol } from '../host/rpc-protocol';
import { URI } from '../../core/types/uri';
import { generateUuid } from '../../core/types/uuid';

export interface Command {
	title: string;
	command: string;
	tooltip?: string;
	arguments?: any[];
}

export interface SourceControlResourceState {
	readonly resourceUri: URI;
	readonly command?: Command;
	readonly decorations?: { strikeThrough?: boolean; faded?: boolean; tooltip?: string; letter?: string; color?: string };
	readonly contextValue?: string;
}

export interface SourceControlResourceGroup {
	readonly id: string;
	readonly label: string;
	resourceStates: SourceControlResourceState[];
	hideWhenEmpty?: boolean;
}

export interface SourceControlInputBox {
	value: string;
	placeholder: string;
	visible: boolean;
	readonly onDidChange: Event<string>;
}

export interface SourceControl {
	readonly id: string;
	label: string;
	readonly rootUri: URI | undefined;
	readonly inputBox: SourceControlInputBox;
	count: number;
	quickDiffProvider?: unknown;
	commitTemplate?: string;
	readonly onDidChangeCommitTemplate: Event<string>;
	createResourceGroup(id: string, label: string): SourceControlResourceGroup;
	dispose(): void;
}

export interface IScmApi {
	createSourceControl(id: string, label: string, rootUri?: URI): SourceControl;
}

interface IResourceGroupInternal extends SourceControlResourceGroup {
	readonly internalId: string;
	readonly sourceControlId: string;
}

/**
 * SCM bridge. `createSourceControl` produces a full source control
 * object; every mutation is mirrored to the main side so the SCM
 * viewlet can render the groups and states.
 */
export class ExtHostSCM extends Disposable {
	private readonly _sourceControls = new Map<string, SourceControl>();
	private readonly _groups = new Map<string, IResourceGroupInternal>();

	private readonly _onDidChangeInputBox = this._register(new Emitter<{ sourceControlId: string; value: string }>());
	readonly onDidChangeInputBox: Event<{ sourceControlId: string; value: string }> = this._onDidChangeInputBox.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public createSourceControl(id: string, label: string, rootUri?: URI): SourceControl {
		if (this._sourceControls.has(id)) {
			throw new Error(`SourceControl '${id}' sudah ada`);
		}
		const inputBox = new SourceControlInputBoxImpl(this._rpc, id);
		const self = this;
		const sourceControl: SourceControl = {
			id,
			label,
			rootUri,
			inputBox,
			count: 0,
			commitTemplate: '',
			onDidChangeCommitTemplate: Event.None,
			createResourceGroup: (groupId: string, groupLabel: string) => self._createResourceGroup(id, groupId, groupLabel),
			dispose: () => self._disposeSourceControl(id)
		};
		this._sourceControls.set(id, sourceControl);
		this._rpc.notify('main', 'scm.create', { id, label, rootUri: rootUri?.toString() });
		return sourceControl;
	}

	public get api(): IScmApi {
		return {
			createSourceControl: (id: string, label: string, rootUri?: URI) => this.createSourceControl(id, label, rootUri)
		};
	}

	private _createResourceGroup(sourceControlId: string, groupId: string, label: string): SourceControlResourceGroup {
		const self = this;
		const internalId = generateUuid();
		let states: SourceControlResourceState[] = [];
		const group: IResourceGroupInternal = {
			internalId,
			sourceControlId,
			id: groupId,
			label,
			get resourceStates() {
				return states;
			},
			set resourceStates(value: SourceControlResourceState[]) {
				states = value;
				self._syncGroup(internalId);
			},
			hideWhenEmpty: false
		};
		this._groups.set(internalId, group);
		this._rpc.notify('main', 'scm.createGroup', { internalId, sourceControlId, id: groupId, label });
		this._syncGroup(internalId);
		return group;
	}

	private _syncGroup(internalId: string): void {
		const group = this._groups.get(internalId);
		if (!group) {
			return;
		}
		this._rpc.notify('main', 'scm.updateGroup', {
			internalId,
			label: group.label,
			hideWhenEmpty: group.hideWhenEmpty ?? false,
			states: group.resourceStates.map(s => ({
				uri: s.resourceUri.toString(),
				command: s.command,
				decorations: s.decorations,
				contextValue: s.contextValue
			}))
		});
	}

	private _disposeSourceControl(id: string): void {
		const scm = this._sourceControls.get(id);
		if (!scm) {
			return;
		}
		this._sourceControls.delete(id);
		for (const [internalId, group] of this._groups) {
			if (group.sourceControlId === id) {
				this._groups.delete(internalId);
			}
		}
		this._rpc.notify('main', 'scm.dispose', { id });
	}
}

class SourceControlInputBoxImpl implements SourceControlInputBox {
	private _value = '';
	private _placeholder = '';
	private _visible = true;

	private readonly _onDidChange = new Emitter<string>();
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(
		private readonly _rpc: RPCProtocol,
		private readonly _sourceControlId: string
	) {}

	public get value(): string {
		return this._value;
	}

	public set value(value: string) {
		if (value !== this._value) {
			this._value = value;
			this._rpc.notify('main', 'scm.inputBox', { sourceControlId: this._sourceControlId, value });
			this._onDidChange.fire(value);
		}
	}

	public get placeholder(): string {
		return this._placeholder;
	}

	public set placeholder(value: string) {
		this._placeholder = value;
		this._rpc.notify('main', 'scm.inputBoxPlaceholder', { sourceControlId: this._sourceControlId, value });
	}

	public get visible(): boolean {
		return this._visible;
	}

	public set visible(value: boolean) {
		this._visible = value;
		this._rpc.notify('main', 'scm.inputBoxVisible', { sourceControlId: this._sourceControlId, value });
	}
}
