/**
 * Dardcor Code - Hierarchical Setting Section Categorization Model
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { ISettingDescriptor, SETTINGS_CATEGORIES } from './settings-editor';

export interface ISettingsGroupNode {
	readonly id: string;
	readonly label: string;
	readonly depth: number;
	readonly settings: readonly ISettingDescriptor[];
	readonly children: readonly ISettingsGroupNode[];
}

export interface ISettingsGroupChangeEvent {
	readonly groupId: string;
	readonly settingKey: string;
	readonly value: unknown;
}

export class SettingsGroupModel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<ISettingsGroupChangeEvent>());
	readonly onDidChange: Event<ISettingsGroupChangeEvent> = this._onDidChange.event;

	private readonly _root: ISettingsGroupNode;
	private readonly _settingsByKey = new Map<string, ISettingDescriptor>();
	private readonly _groupById = new Map<string, ISettingsGroupNode>();

	constructor(settings: readonly ISettingDescriptor[] = []) {
		super();
		this._root = SettingsGroupModel.buildTree(settings);
		this._index(this._root);
	}

	public get root(): ISettingsGroupNode {
		return this._root;
	}

	public getSetting(key: string): ISettingDescriptor | undefined {
		return this._settingsByKey.get(key);
	}

	public getGroup(groupId: string): ISettingsGroupNode | undefined {
		return this._groupById.get(groupId);
	}

	public getGroupOfSetting(key: string): ISettingsGroupNode | undefined {
		const setting = this._settingsByKey.get(key);
		if (!setting) {
			return undefined;
		}
		return this._groupById.get(`group:${setting.category}`);
	}

	public getSettingsInGroup(groupId: string): ISettingDescriptor[] {
		const node = this._groupById.get(groupId);
		if (!node) {
			return [];
		}
		const result: ISettingDescriptor[] = [...node.settings];
		for (const child of node.children) {
			result.push(...this.getSettingsInGroup(child.id));
		}
		return result;
	}

	public flatten(): ISettingDescriptor[] {
		const result: ISettingDescriptor[] = [];
		const walk = (node: ISettingsGroupNode): void => {
			result.push(...node.settings);
			for (const child of node.children) {
				walk(child);
			}
		};
		walk(this._root);
		return result;
	}

	public get count(): number {
		return this._settingsByKey.size;
	}

	public setValue(key: string, value: unknown): void {
		const setting = this._settingsByKey.get(key);
		if (!setting) {
			return;
		}
		const group = this.getGroupOfSetting(key);
		this._onDidChange.fire({
			groupId: group?.id ?? 'group:All',
			settingKey: key,
			value
		});
	}

	public static buildTree(settings: readonly ISettingDescriptor[]): ISettingsGroupNode {
		const allNode: ISettingsGroupNode = {
			id: 'group:All',
			label: 'Semua',
			depth: 0,
			settings,
			children: []
		};

		const children: ISettingsGroupNode[] = [];
		for (const category of SETTINGS_CATEGORIES) {
			const inCategory = settings.filter(s => s.category === category);
			const id = `group:${category}`;
			const child: ISettingsGroupNode = {
				id,
				label: category,
				depth: 1,
				settings: inCategory,
				children: []
			};
			children.push(child);
		}

		const uncategorized = settings.filter(s => !(SETTINGS_CATEGORIES as readonly string[]).includes(s.category));
		if (uncategorized.length > 0) {

			children.push({
				id: 'group:Lainnya',
				label: 'Lainnya',
				depth: 1,
				settings: uncategorized,
				children: []
			});
		}

		return { ...allNode, children };
	}

	private _index(node: ISettingsGroupNode): void {
		this._groupById.set(node.id, node);
		for (const setting of node.settings) {
			this._settingsByKey.set(setting.key, setting);
		}
		for (const child of node.children) {
			this._index(child);
		}
	}
}
