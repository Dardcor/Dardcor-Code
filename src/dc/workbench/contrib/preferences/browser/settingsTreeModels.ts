/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from '../../../../base/common/arrays.js';
import { Emitter } from '../../../../base/common/event.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { escapeRegExpCharacters, isFalsyOrWhitespace } from '../../../../base/common/strings.js';
import { isUndefinedOrNull } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ConfigurationTarget, getLanguageTagSettingPlainKey, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationDefaultValueSource, ConfigurationScope, EditPresentationTypes, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { USER_LOCAL_AND_REMOTE_SETTINGS } from '../../../../platform/request/common/request.js';
import { APPLICATION_SCOPES, FOLDER_SCOPES, IWorkbenchConfigurationService, LOCAL_MACHINE_SCOPES, REMOTE_MACHINE_SCOPES, WORKSPACE_SCOPES } from '../../../services/configuration/common/configuration.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionSetting, ISearchResult, ISetting, ISettingMatch, SettingMatchType, SettingValueType } from '../../../services/preferences/common/preferences.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { ENABLE_EXTENSION_TOGGLE_SETTINGS, ENABLE_LANGUAGE_FILTER, MODIFIED_SETTING_TAG, POLICY_SETTING_TAG, REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG, compareTwoNullableNumbers, wordifyKey } from '../common/preferences.js';
import { SettingsTarget } from './preferencesWidgets.js';
import { ITOCEntry, tocData } from './settingsLayout.js';

export const ONLINE_SERVICES_SETTING_TAG = 'usesOnlineServices';

export interface ISettingsEditorViewState {
	settingsTarget: SettingsTarget;
	query?: string;
	tagFilters?: Set<string>;
	extensionFilters?: Set<string>;
	featureFilters?: Set<string>;
	idFilters?: Set<string>;
	languageFilter?: string;
	categoryFilter?: SettingsTreeGroupElement;
}

export abstract class SettingsTreeElement extends Disposable {
	id: string;
	parent?: SettingsTreeGroupElement;

	private _tabbable = false;

	private readonly _onDidChangeTabbable = this._register(new Emitter<void>());
	get onDidChangeTabbable() { return this._onDidChangeTabbable.event; }

	constructor(_id: string) {
		super();
		this.id = _id;
	}

	get tabbable(): boolean {
		return this._tabbable;
	}

	set tabbable(value: boolean) {
		this._tabbable = value;
		this._onDidChangeTabbable.fire();
	}
}

export type SettingsTreeGroupChild = (SettingsTreeGroupElement | SettingsTreeSettingElement | SettingsTreeNewExtensionsElement);

export class SettingsTreeGroupElement extends SettingsTreeElement {
	count?: number;
	label: string;
	level: number;
	isFirstGroup: boolean;

	private _childSettingKeys: Set<string> = new Set();
	private _children: SettingsTreeGroupChild[] = [];

	get children(): SettingsTreeGroupChild[] {
		return this._children;
	}

	set children(newChildren: SettingsTreeGroupChild[]) {
		this._children = newChildren;

		this._childSettingKeys = new Set();
		this._children.forEach(child => {
			if (child instanceof SettingsTreeSettingElement) {
				this._childSettingKeys.add(child.setting.key);
			}
		});
	}

	constructor(_id: string, count: number | undefined, label: string, level: number, isFirstGroup: boolean) {
		super(_id);

		this.count = count;
		this.label = label;
		this.level = level;
		this.isFirstGroup = isFirstGroup;
	}

	containsSetting(key: string): boolean {
		return this._childSettingKeys.has(key);
	}
}

export class SettingsTreeNewExtensionsElement extends SettingsTreeElement {
	constructor(_id: string, public readonly extensionIds: string[]) {
		super(_id);
	}
}

export class SettingsTreeSettingElement extends SettingsTreeElement {
	private static readonly MAX_DESC_LINES = 20;

	setting: ISetting;

	private _displayCategory: string | null = null;
	private _displayLabel: string | null = null;

	value: any;

	scopeValue: any;

	defaultValue?: any;

	defaultValueSource: ConfigurationDefaultValueSource | undefined;

	isConfigured = false;

	isUntrusted = false;

	hasPolicyValue = false;

	tags?: Set<string>;
	overriddenScopeList: string[] = [];
	overriddenDefaultsLanguageList: string[] = [];

	languageOverrideValues: Map<string, IConfigurationValue<unknown>> = new Map<string, IConfigurationValue<unknown>>();

	description!: string;
	valueType!: SettingValueType;

	constructor(
		setting: ISetting,
		parent: SettingsTreeGroupElement,
		readonly settingsTarget: SettingsTarget,
		private readonly isWorkspaceTrusted: boolean,
		private readonly languageFilter: string | undefined,
		private readonly languageService: ILanguageService,
		private readonly productService: IProductService,
		private readonly userDataProfileService: IUserDataProfileService,
		private readonly configurationService: IWorkbenchConfigurationService,
	) {
		super(sanitizeId(parent.id + '_' + setting.key));
		this.setting = setting;
		this.parent = parent;

		this.initSettingDescription();
		this.initSettingValueType();
	}

	get displayCategory(): string {
		if (!this._displayCategory) {
			this.initLabels();
		}

		return this._displayCategory!;
	}

	get displayLabel(): string {
		if (!this._displayLabel) {
			this.initLabels();
		}

		return this._displayLabel!;
	}

	private initLabels(): void {
		if (this.setting.title) {
			this._displayLabel = this.setting.title;
			this._displayCategory = this.setting.categoryLabel ?? null;
			return;
		}
		const displayKeyFormat = settingKeyToDisplayFormat(this.setting.key, this.parent!.id, this.setting.isLanguageTagSetting);
		this._displayLabel = displayKeyFormat.label;
		this._displayCategory = displayKeyFormat.category;
	}

	private initSettingDescription() {
		if (this.setting.description.length > SettingsTreeSettingElement.MAX_DESC_LINES) {
			const truncatedDescLines = this.setting.description.slice(0, SettingsTreeSettingElement.MAX_DESC_LINES);
			truncatedDescLines.push('[...]');
			this.description = truncatedDescLines.join('\n');
		} else {
			this.description = this.setting.description.join('\n');
		}
	}

	private initSettingValueType() {
		if (isExtensionToggleSetting(this.setting, this.productService)) {
			this.valueType = SettingValueType.ExtensionToggle;
		} else if (this.setting.enum && (!this.setting.type || settingTypeEnumRenderable(this.setting.type))) {
			this.valueType = SettingValueType.Enum;
		} else if (this.setting.type === 'string') {
			if (this.setting.editPresentation === EditPresentationTypes.Multiline) {
				this.valueType = SettingValueType.MultilineString;
			} else {
				this.valueType = SettingValueType.String;
			}
		} else if (isExcludeSetting(this.setting)) {
			this.valueType = SettingValueType.Exclude;
		} else if (isIncludeSetting(this.setting)) {
			this.valueType = SettingValueType.Include;
		} else if (this.setting.type === 'integer') {
			this.valueType = SettingValueType.Integer;
		} else if (this.setting.type === 'number') {
			this.valueType = SettingValueType.Number;
		} else if (this.setting.type === 'boolean') {
			this.valueType = SettingValueType.Boolean;
		} else if (this.setting.type === 'array' && this.setting.arrayItemType &&
			['string', 'enum', 'number', 'integer'].includes(this.setting.arrayItemType)) {
			this.valueType = SettingValueType.Array;
		} else if (Array.isArray(this.setting.type) && this.setting.type.includes(SettingValueType.Null) && this.setting.type.length === 2) {
			if (this.setting.type.includes(SettingValueType.Integer)) {
				this.valueType = SettingValueType.NullableInteger;
			} else if (this.setting.type.includes(SettingValueType.Number)) {
				this.valueType = SettingValueType.NullableNumber;
			} else {
				this.valueType = SettingValueType.Complex;
			}
		} else {
			const schemaType = getObjectSettingSchemaType(this.setting);
			if (schemaType) {
				if (this.setting.allKeysAreBoolean) {
					this.valueType = SettingValueType.BooleanObject;
				} else if (schemaType === 'simple') {
					this.valueType = SettingValueType.Object;
				} else {
					this.valueType = SettingValueType.ComplexObject;
				}
			} else if (this.setting.isLanguageTagSetting) {
				this.valueType = SettingValueType.LanguageTag;
			} else {
				this.valueType = SettingValueType.Complex;
			}
		}
	}

	inspectSelf() {
		const targetToInspect = this.getTargetToInspect(this.setting);
		const inspectResult = inspectSetting(this.setting.key, targetToInspect, this.languageFilter, this.configurationService);
		this.update(inspectResult, this.isWorkspaceTrusted);
	}

	private getTargetToInspect(setting: ISetting): SettingsTarget {
		if (!this.userDataProfileService.currentProfile.isDefault && !this.userDataProfileService.currentProfile.useDefaultFlags?.settings) {
			if (setting.scope === ConfigurationScope.APPLICATION) {
				return ConfigurationTarget.APPLICATION;
			}
			if (this.configurationService.isSettingAppliedForAllProfiles(setting.key) && this.settingsTarget === ConfigurationTarget.USER_LOCAL) {
				return ConfigurationTarget.APPLICATION;
			}
		}
		return this.settingsTarget;
	}

	private update(inspectResult: IInspectResult, isWorkspaceTrusted: boolean): void {
		let { isConfigured, inspected, targetSelector, inspectedLanguageOverrides, languageSelector } = inspectResult;

		switch (targetSelector) {
			case 'workspaceFolderValue':
			case 'workspaceValue':
				this.isUntrusted = !!this.setting.restricted && !isWorkspaceTrusted;
				break;
		}

		let displayValue = isConfigured ? inspected[targetSelector] : inspected.defaultValue;
		const overriddenScopeList: string[] = [];
		const overriddenDefaultsLanguageList: string[] = [];
		if ((languageSelector || targetSelector !== 'workspaceValue') && typeof inspected.workspaceValue !== 'undefined') {
			overriddenScopeList.push('workspace:');
		}
		if ((languageSelector || targetSelector !== 'userRemoteValue') && typeof inspected.userRemoteValue !== 'undefined') {
			overriddenScopeList.push('remote:');
		}
		if ((languageSelector || targetSelector !== 'userLocalValue') && typeof inspected.userLocalValue !== 'undefined') {
			overriddenScopeList.push('user:');
		}

		if (inspected.overrideIdentifiers) {
			for (const overrideIdentifier of inspected.overrideIdentifiers) {
				const inspectedOverride = inspectedLanguageOverrides.get(overrideIdentifier);
				if (inspectedOverride) {
					if (this.languageService.isRegisteredLanguageId(overrideIdentifier)) {
						if (languageSelector !== overrideIdentifier && typeof inspectedOverride.default?.override !== 'undefined') {
							overriddenDefaultsLanguageList.push(overrideIdentifier);
						}
						if ((languageSelector !== overrideIdentifier || targetSelector !== 'workspaceValue') && typeof inspectedOverride.workspace?.override !== 'undefined') {
							overriddenScopeList.push(`workspace:${overrideIdentifier}`);
						}
						if ((languageSelector !== overrideIdentifier || targetSelector !== 'userRemoteValue') && typeof inspectedOverride.userRemote?.override !== 'undefined') {
							overriddenScopeList.push(`remote:${overrideIdentifier}`);
						}
						if ((languageSelector !== overrideIdentifier || targetSelector !== 'userLocalValue') && typeof inspectedOverride.userLocal?.override !== 'undefined') {
							overriddenScopeList.push(`user:${overrideIdentifier}`);
						}
					}
					this.languageOverrideValues.set(overrideIdentifier, inspectedOverride);
				}
			}
		}
		this.overriddenScopeList = overriddenScopeList;
		this.overriddenDefaultsLanguageList = overriddenDefaultsLanguageList;

		this.defaultValueSource = this.setting.nonLanguageSpecificDefaultValueSource;

		if (inspected.policyValue !== undefined) {
			this.hasPolicyValue = true;
			isConfigured = false;
			displayValue = inspected.policyValue;
			this.scopeValue = inspected.policyValue;
			this.defaultValue = inspected.defaultValue;
		} else if (languageSelector && this.languageOverrideValues.has(languageSelector)) {
			const overrideValues = this.languageOverrideValues.get(languageSelector)!;
			displayValue = (isConfigured ? overrideValues[targetSelector] : overrideValues.defaultValue) ?? displayValue;
			this.scopeValue = isConfigured && overrideValues[targetSelector];
			this.defaultValue = overrideValues.defaultValue ?? inspected.defaultValue;

			const registryValues = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationDefaultsOverrides();
			const source = registryValues.get(`[${languageSelector}]`)?.source;
			const overrideValueSource = source instanceof Map ? source.get(this.setting.key) : undefined;
			if (overrideValueSource) {
				this.defaultValueSource = overrideValueSource;
			}
		} else {
			this.scopeValue = isConfigured && inspected[targetSelector];
			this.defaultValue = inspected.defaultValue;
		}

		this.value = displayValue;
		this.isConfigured = isConfigured;
		if (isConfigured || this.setting.tags || this.tags || this.setting.restricted || this.hasPolicyValue) {
			this.tags = new Set<string>();
			if (isConfigured) {
				this.tags.add(MODIFIED_SETTING_TAG);
			}

			this.setting.tags?.forEach(tag => this.tags!.add(tag));

			if (this.setting.restricted) {
				this.tags.add(REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG);
			}

			if (this.hasPolicyValue) {
				this.tags.add(POLICY_SETTING_TAG);
			}
		}
	}

	matchesAllTags(tagFilters?: Set<string>): boolean {
		if (!tagFilters?.size) {
			return true;
		}

		if (!this.tags) {
			this.inspectSelf();
		}

		if (tagFilters.has('stable')) {
			if (this.tags?.has('preview') || this.tags?.has('experimental')) {
				return false;
			}
			const otherFilters = new Set(Array.from(tagFilters).filter(tag => tag !== 'stable'));
			if (otherFilters.size === 0) {
				return true;
			}
			return !!this.tags?.size &&
				Array.from(otherFilters).every(tag => this.tags!.has(tag));
		}

		return !!this.tags?.size &&
			Array.from(tagFilters).every(tag => this.tags!.has(tag));
	}

	matchesScope(scope: SettingsTarget, isRemote: boolean): boolean {
		const configTarget = URI.isUri(scope) ? ConfigurationTarget.WORKSPACE_FOLDER : scope;

		if (!this.setting.scope) {
			return true;
		}

		if (configTarget === ConfigurationTarget.APPLICATION) {
			return APPLICATION_SCOPES.includes(this.setting.scope);
		}

		if (configTarget === ConfigurationTarget.WORKSPACE_FOLDER) {
			return FOLDER_SCOPES.includes(this.setting.scope);
		}

		if (configTarget === ConfigurationTarget.WORKSPACE) {
			return WORKSPACE_SCOPES.includes(this.setting.scope);
		}

		if (configTarget === ConfigurationTarget.USER_REMOTE) {
			return REMOTE_MACHINE_SCOPES.includes(this.setting.scope) || USER_LOCAL_AND_REMOTE_SETTINGS.includes(this.setting.key);
		}

		if (configTarget === ConfigurationTarget.USER_LOCAL) {
			if (isRemote) {
				return LOCAL_MACHINE_SCOPES.includes(this.setting.scope) || USER_LOCAL_AND_REMOTE_SETTINGS.includes(this.setting.key);
			}
		}

		return true;
	}

	matchesAnyExtension(extensionFilters?: Set<string>): boolean {
		if (!extensionFilters || !extensionFilters.size) {
			return true;
		}

		if (!this.setting.extensionInfo) {
			return false;
		}

		return Array.from(extensionFilters).some(extensionId => extensionId.toLowerCase() === this.setting.extensionInfo!.id.toLowerCase());
	}

	matchesAnyFeature(featureFilters?: Set<string>): boolean {
		if (!featureFilters || !featureFilters.size) {
			return true;
		}

		if (this.setting.extensionInfo) {
			return false;
		}

		if (featureFilters.has('chat')) {
			const chatFeatures = tocData.children!.find(child => child.id === 'chat');
			if (chatFeatures?.children) {
				const patterns = chatFeatures.children
					.flatMap(feature => feature.settings ?? [])
					.map(setting => createSettingMatchRegExp(setting));
				if (patterns.some(pattern => pattern.test(this.setting.key))) {
					return true;
				}
			}
		}

		const features = tocData.children!.find(child => child.id === 'features');
		return Array.from(featureFilters).some(filter => {
			if (features?.children) {
				const feature = features.children.find(feature => 'features/' + filter === feature.id);
				if (feature?.settings) {
					const patterns = feature.settings.map(setting => createSettingMatchRegExp(setting));
					return patterns.some(pattern => pattern.test(this.setting.key));
				} else {
					return false;
				}
			} else {
				return false;
			}
		});
	}

	matchesAnyId(idFilters?: Set<string>): boolean {
		if (!idFilters || !idFilters.size) {
			return true;
		}

		if (idFilters.has(this.setting.key)) {
			return true;
		}

		for (const filter of idFilters) {
			if (filter.endsWith('*')) {
				const prefix = filter.slice(0, -1);
				if (this.setting.key.startsWith(prefix)) {
					return true;
				}
			}
		}

		return false;
	}

	matchesAllLanguages(languageFilter?: string): boolean {
		if (!languageFilter) {
			return true;
		}

		if (!this.languageService.isRegisteredLanguageId(languageFilter)) {
			return false;
		}

		if (this.setting.scope === ConfigurationScope.LANGUAGE_OVERRIDABLE) {
			return true;
		}

		return false;
	}
}


function createSettingMatchRegExp(pattern: string): RegExp {
	pattern = escapeRegExpCharacters(pattern)
		.replace(/\\\*/g, '.*');

	return new RegExp(`^${pattern}$`, 'i');
}

export class SettingsTreeModel implements IDisposable {
	protected _root!: SettingsTreeGroupElement;
	private _tocRoot!: ITOCEntry<ISetting>;
	private readonly _treeElementsBySettingName = new Map<string, SettingsTreeSettingElement[]>();

	constructor(
		protected readonly _viewState: ISettingsEditorViewState,
		private _isWorkspaceTrusted: boolean,
		@IWorkbenchConfigurationService private readonly _configurationService: IWorkbenchConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IUserDataProfileService private readonly _userDataProfileService: IUserDataProfileService,
		@IProductService private readonly _productService: IProductService,
	) {
	}

	get root(): SettingsTreeGroupElement {
		return this._root;
	}

	update(newTocRoot = this._tocRoot): void {
		this._treeElementsBySettingName.clear();

		const newRoot = this.createSettingsTreeGroupElement(newTocRoot);
		if (newRoot.children[0] instanceof SettingsTreeGroupElement) {
			(<SettingsTreeGroupElement>newRoot.children[0]).isFirstGroup = true;
		}

		if (this._root) {
			this.disposeChildren(this._root.children);
			this._root.children = newRoot.children;
			newRoot.dispose();
		} else {
			this._root = newRoot;
		}
	}

	updateWorkspaceTrust(workspaceTrusted: boolean): void {
		this._isWorkspaceTrusted = workspaceTrusted;
		this.updateRequireTrustedTargetElements();
	}

	private disposeChildren(children: SettingsTreeGroupChild[]) {
		for (const child of children) {
			this.disposeChildAndRecurse(child);
		}
	}

	private disposeChildAndRecurse(element: SettingsTreeElement) {
		if (element instanceof SettingsTreeGroupElement) {
			this.disposeChildren(element.children);
		}

		element.dispose();
	}

	getElementsByName(name: string): SettingsTreeSettingElement[] | null {
		return this._treeElementsBySettingName.get(name) ?? null;
	}

	updateElementsByName(name: string): void {
		if (!this._treeElementsBySettingName.has(name)) {
			return;
		}

		this.reinspectSettings(this._treeElementsBySettingName.get(name)!);
	}

	private updateRequireTrustedTargetElements(): void {
		this.reinspectSettings([...this._treeElementsBySettingName.values()].flat().filter(s => s.isUntrusted));
	}

	private reinspectSettings(settings: SettingsTreeSettingElement[]): void {
		for (const element of settings) {
			element.inspectSelf();
		}
	}

	private createSettingsTreeGroupElement(tocEntry: ITOCEntry<ISetting>, parent?: SettingsTreeGroupElement): SettingsTreeGroupElement {
		const depth = parent ? this.getDepth(parent) + 1 : 0;
		const element = new SettingsTreeGroupElement(tocEntry.id, undefined, tocEntry.label, depth, false);
		element.parent = parent;

		const children: SettingsTreeGroupChild[] = [];
		if (tocEntry.settings) {
			const settingChildren = tocEntry.settings.map(s => this.createSettingsTreeSettingElement(s, element));
			for (const child of settingChildren) {
				if (!child.setting.deprecationMessage) {
					children.push(child);
				} else {
					child.inspectSelf();
					if (child.isConfigured) {
						children.push(child);
					} else {
						child.dispose();
					}
				}
			}
		}

		if (tocEntry.children) {
			const groupChildren = tocEntry.children.map(child => this.createSettingsTreeGroupElement(child, element));
			children.push(...groupChildren);
		}

		element.children = children;

		return element;
	}

	private getDepth(element: SettingsTreeElement): number {
		if (element.parent) {
			return 1 + this.getDepth(element.parent);
		} else {
			return 0;
		}
	}

	private createSettingsTreeSettingElement(setting: ISetting, parent: SettingsTreeGroupElement): SettingsTreeSettingElement {
		const element = new SettingsTreeSettingElement(
			setting,
			parent,
			this._viewState.settingsTarget,
			this._isWorkspaceTrusted,
			this._viewState.languageFilter,
			this._languageService,
			this._productService,
			this._userDataProfileService,
			this._configurationService);

		const nameElements = this._treeElementsBySettingName.get(setting.key) ?? [];
		nameElements.push(element);
		this._treeElementsBySettingName.set(setting.key, nameElements);
		return element;
	}

	dispose() {
		this._treeElementsBySettingName.clear();
		this.disposeChildAndRecurse(this._root);
	}
}

interface IInspectResult {
	isConfigured: boolean;
	inspected: IConfigurationValue<unknown>;
	targetSelector: 'applicationValue' | 'userLocalValue' | 'userRemoteValue' | 'workspaceValue' | 'workspaceFolderValue';
	inspectedLanguageOverrides: Map<string, IConfigurationValue<unknown>>;
	languageSelector: string | undefined;
}

export function inspectSetting(key: string, target: SettingsTarget, languageFilter: string | undefined, configurationService: IWorkbenchConfigurationService): IInspectResult {
	const inspectOverrides = URI.isUri(target) ? { resource: target } : undefined;
	const inspected = configurationService.inspect(key, inspectOverrides);
	const targetSelector = target === ConfigurationTarget.APPLICATION ? 'applicationValue' :
		target === ConfigurationTarget.USER_LOCAL ? 'userLocalValue' :
			target === ConfigurationTarget.USER_REMOTE ? 'userRemoteValue' :
				target === ConfigurationTarget.WORKSPACE ? 'workspaceValue' :
					'workspaceFolderValue';
	const targetOverrideSelector = target === ConfigurationTarget.APPLICATION ? 'application' :
		target === ConfigurationTarget.USER_LOCAL ? 'userLocal' :
			target === ConfigurationTarget.USER_REMOTE ? 'userRemote' :
				target === ConfigurationTarget.WORKSPACE ? 'workspace' :
					'workspaceFolder';
	let isConfigured = typeof inspected[targetSelector] !== 'undefined';

	const overrideIdentifiers = inspected.overrideIdentifiers;
	const inspectedLanguageOverrides = new Map<string, IConfigurationValue<unknown>>();

	if (languageFilter) {
		isConfigured = false;
	}
	if (overrideIdentifiers) {
		for (const overrideIdentifier of overrideIdentifiers) {
			inspectedLanguageOverrides.set(overrideIdentifier, configurationService.inspect(key, { overrideIdentifier }));
		}

		if (languageFilter) {
			if (inspectedLanguageOverrides.has(languageFilter)) {
				const overrideValue = inspectedLanguageOverrides.get(languageFilter)![targetOverrideSelector]?.override;
				if (typeof overrideValue !== 'undefined') {
					isConfigured = true;
				}
			}
		}
	}

	return { isConfigured, inspected, targetSelector, inspectedLanguageOverrides, languageSelector: languageFilter };
}

export function sanitizeId(id: string): string {
	return id.replace(/[\.\/]/g, '_');
}

export function settingKeyToDisplayFormat(key: string, groupId: string = '', isLanguageTagSetting: boolean = false): { category: string; label: string } {
	const lastDotIdx = key.lastIndexOf('.');
	let category = '';
	if (lastDotIdx >= 0) {
		category = key.substring(0, lastDotIdx);
		key = key.substring(lastDotIdx + 1);
	}

	groupId = groupId.replace(/\//g, '.');
	category = trimCategoryForGroup(category, groupId);
	category = wordifyKey(category);

	if (isLanguageTagSetting) {
		key = getLanguageTagSettingPlainKey(key);
		key = '$(bracket) ' + key;
	}

	const label = wordifyKey(key);
	return { category, label };
}

function trimCategoryForGroup(category: string, groupId: string): string {
	const doTrim = (forward: boolean) => {
		if (!/insiders$/i.test(category)) {
			groupId = groupId.replace(/-?insiders$/i, '');
		}
		const parts = groupId.split('.')
			.map(part => {
				if (part.replace(/-/g, '').toLowerCase() === category.toLowerCase()) {
					return part.replace(/-/g, '');
				} else {
					return part;
				}
			});
		while (parts.length) {
			const reg = new RegExp(`^${parts.join('\\.')}(\\.|$)`, 'i');
			if (reg.test(category)) {
				return category.replace(reg, '');
			}

			if (forward) {
				parts.pop();
			} else {
				parts.shift();
			}
		}

		return null;
	};

	let trimmed = doTrim(true);
	if (trimmed === null) {
		trimmed = doTrim(false);
	}

	if (trimmed === null) {
		trimmed = category;
	}

	return trimmed;
}

function isExtensionToggleSetting(setting: ISetting, productService: IProductService): boolean {
	return ENABLE_EXTENSION_TOGGLE_SETTINGS &&
		!!productService.extensionRecommendations &&
		!!setting.displayExtensionId;
}

function isExcludeSetting(setting: ISetting): boolean {
	return setting.key === 'files.exclude' ||
		setting.key === 'search.exclude' ||
		setting.key === 'workbench.localHistory.exclude' ||
		setting.key === 'explorer.autoRevealExclude' ||
		setting.key === 'files.readonlyExclude' ||
		setting.key === 'files.watcherExclude';
}

function isIncludeSetting(setting: ISetting): boolean {
	return setting.key === 'files.readonlyInclude';
}

export function objectSettingSupportsRemoveDefaultValue(key: string): boolean {
	return key === 'workbench.editor.customLabels.patterns';
}

function isSimpleType(type: string | undefined): boolean {
	return type === 'string' || type === 'boolean' || type === 'integer' || type === 'number';
}

function getObjectRenderableSchemaType(schema: IJSONSchema, key: string): 'simple' | 'complex' | false {
	const { type } = schema;

	if (Array.isArray(type)) {
		if (objectSettingSupportsRemoveDefaultValue(key) && type.length === 2) {
			if (type.includes('null') && (type.includes('string') || type.includes('boolean') || type.includes('integer') || type.includes('number'))) {
				return 'simple';
			}
		}

		for (const t of type) {
			if (!isSimpleType(t)) {
				return false;
			}
		}
		return 'complex';
	}

	if (isSimpleType(type)) {
		return 'simple';
	}

	if (type === 'array') {
		if (schema.items) {
			const itemSchemas = Array.isArray(schema.items) ? schema.items : [schema.items];
			for (const { type } of itemSchemas) {
				if (Array.isArray(type)) {
					for (const t of type) {
						if (!isSimpleType(t)) {
							return false;
						}
					}
					return 'complex';
				}
				if (!isSimpleType(type)) {
					return false;
				}
				return 'complex';
			}
		}
		return false;
	}

	return false;
}

function getObjectSettingSchemaType({
	key,
	type,
	objectProperties,
	objectPatternProperties,
	objectAdditionalProperties
}: ISetting): 'simple' | 'complex' | false {
	if (type !== 'object') {
		return false;
	}

	if (
		isUndefinedOrNull(objectProperties) &&
		isUndefinedOrNull(objectPatternProperties) &&
		isUndefinedOrNull(objectAdditionalProperties)
	) {
		return false;
	}

	if ((objectAdditionalProperties === true || objectAdditionalProperties === undefined)
		&& !Object.keys(objectPatternProperties ?? {}).includes('.*')) {
		return false;
	}

	const schemas = [...Object.values(objectProperties ?? {}), ...Object.values(objectPatternProperties ?? {})];

	if (objectAdditionalProperties && typeof objectAdditionalProperties === 'object') {
		schemas.push(objectAdditionalProperties);
	}

	let schemaType: 'simple' | 'complex' | false = 'simple';
	for (const schema of schemas) {
		for (const subSchema of Array.isArray(schema.anyOf) ? schema.anyOf : [schema]) {
			const subSchemaType = getObjectRenderableSchemaType(subSchema, key);
			if (subSchemaType === false) {
				return false;
			}
			if (subSchemaType === 'complex') {
				schemaType = 'complex';
			}
		}
	}

	return schemaType;
}

function settingTypeEnumRenderable(_type: string | string[]) {
	const enumRenderableSettingTypes = ['string', 'boolean', 'null', 'integer', 'number'];
	const type = Array.isArray(_type) ? _type : [_type];
	return type.every(type => enumRenderableSettingTypes.includes(type));
}

export const enum SearchResultIdx {
	Local = 0,
	Remote = 1,
	NewExtensions = 2,
	Embeddings = 3,
	AiSelected = 4
}

export class SearchResultModel extends SettingsTreeModel {
	private rawSearchResults: ISearchResult[] | null = null;
	private cachedUniqueSearchResults: Map<boolean, ISearchResult | null>;
	private newExtensionSearchResults: ISearchResult | null = null;
	private searchResultCount: number | null = null;
	private settingsOrderByTocIndex: Map<string, number> | null;
	private aiFilterEnabled: boolean = false;

	readonly id = 'searchResultModel';

	constructor(
		viewState: ISettingsEditorViewState,
		settingsOrderByTocIndex: Map<string, number> | null,
		isWorkspaceTrusted: boolean,
		@IWorkbenchConfigurationService configurationService: IWorkbenchConfigurationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ILanguageService languageService: ILanguageService,
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IProductService productService: IProductService
	) {
		super(viewState, isWorkspaceTrusted, configurationService, languageService, userDataProfileService, productService);
		this.settingsOrderByTocIndex = settingsOrderByTocIndex;
		this.cachedUniqueSearchResults = new Map();
		this.update({ id: 'searchResultModel', label: '' });
	}

	set showAiResults(show: boolean) {
		this.aiFilterEnabled = show;
		this.updateChildren();
	}

	private sortResults(filterMatches: ISettingMatch[]): ISettingMatch[] {
		if (this.settingsOrderByTocIndex) {
			for (const match of filterMatches) {
				match.setting.internalOrder = this.settingsOrderByTocIndex.get(match.setting.key);
			}
		}

		if (!this._viewState.query) {
			return filterMatches.sort((a, b) => compareTwoNullableNumbers(a.setting.internalOrder, b.setting.internalOrder));
		}

		filterMatches.sort((a, b) => {
			if (a.matchType !== b.matchType) {
				return b.matchType - a.matchType;
			} else if ((a.matchType & SettingMatchType.NonContiguousWordsInSettingsLabel) || (a.matchType & SettingMatchType.ContiguousWordsInSettingsLabel)) {
				return (b.keyMatchScore - a.keyMatchScore) || compareTwoNullableNumbers(a.setting.internalOrder, b.setting.internalOrder);
			} else if (a.matchType === SettingMatchType.RemoteMatch) {
				return b.score - a.score;
			} else {
				return compareTwoNullableNumbers(a.setting.internalOrder, b.setting.internalOrder);
			}
		});

		return arrays.distinct(filterMatches, (match) => match.setting.key);
	}

	getUniqueSearchResults(): ISearchResult | null {
		const cachedResults = this.cachedUniqueSearchResults.get(this.aiFilterEnabled);
		if (cachedResults) {
			return cachedResults;
		}

		if (!this.rawSearchResults) {
			return null;
		}

		let combinedFilterMatches: ISettingMatch[] = [];

		if (this.aiFilterEnabled) {
			const aiSelectedKeys = new Set<string>();
			const aiSelectedResult = this.rawSearchResults[SearchResultIdx.AiSelected];
			if (aiSelectedResult) {
				aiSelectedResult.filterMatches.forEach(m => aiSelectedKeys.add(m.setting.key));
				combinedFilterMatches = aiSelectedResult.filterMatches;
			}

			const embeddingsResult = this.rawSearchResults[SearchResultIdx.Embeddings];
			if (embeddingsResult) {
				embeddingsResult.filterMatches = embeddingsResult.filterMatches.filter(m => !aiSelectedKeys.has(m.setting.key));
				combinedFilterMatches = combinedFilterMatches.concat(embeddingsResult.filterMatches);
			}
			const result = {
				filterMatches: combinedFilterMatches,
				exactMatch: false
			};
			this.cachedUniqueSearchResults.set(true, result);
			return result;
		}

		const localMatchKeys = new Set<string>();
		const localResult = this.rawSearchResults[SearchResultIdx.Local];
		if (localResult) {
			localResult.filterMatches.forEach(m => localMatchKeys.add(m.setting.key));
			combinedFilterMatches = localResult.filterMatches;
		}

		const remoteResult = this.rawSearchResults[SearchResultIdx.Remote];
		if (remoteResult) {
			remoteResult.filterMatches = remoteResult.filterMatches.filter(m => !localMatchKeys.has(m.setting.key));
			combinedFilterMatches = combinedFilterMatches.concat(remoteResult.filterMatches);

			this.newExtensionSearchResults = this.rawSearchResults[SearchResultIdx.NewExtensions];
		}
		combinedFilterMatches = this.sortResults(combinedFilterMatches);
		const result = {
			filterMatches: combinedFilterMatches,
			exactMatch: localResult.exactMatch
		};
		this.cachedUniqueSearchResults.set(false, result);
		return result;
	}

	getRawResults(): ISearchResult[] {
		return this.rawSearchResults ?? [];
	}

	private getUniqueSearchResultSettings(): ISetting[] {
		return this.getUniqueSearchResults()?.filterMatches.map(m => m.setting) ?? [];
	}

	updateChildren(): void {
		this.update({
			id: 'searchResultModel',
			label: 'searchResultModel',
			settings: this.getUniqueSearchResultSettings()
		});

		const isRemote = !!this.environmentService.remoteAuthority;

		const newChildren = [];
		for (const child of this.root.children) {
			if (child instanceof SettingsTreeSettingElement
				&& child.matchesAllTags(this._viewState.tagFilters)
				&& child.matchesScope(this._viewState.settingsTarget, isRemote)
				&& child.matchesAnyExtension(this._viewState.extensionFilters)
				&& child.matchesAnyId(this._viewState.idFilters)
				&& child.matchesAnyFeature(this._viewState.featureFilters)
				&& child.matchesAllLanguages(this._viewState.languageFilter)) {
				newChildren.push(child);
			} else {
				child.dispose();
			}
		}
		this.root.children = newChildren;
		this.searchResultCount = this.root.children.length;

		if (this.newExtensionSearchResults?.filterMatches.length) {
			let resultExtensionIds = this.newExtensionSearchResults.filterMatches
				.map(result => (<IExtensionSetting>result.setting))
				.filter(setting => setting.extensionName && setting.extensionPublisher)
				.map(setting => `${setting.extensionPublisher}.${setting.extensionName}`);
			resultExtensionIds = arrays.distinct(resultExtensionIds);

			if (resultExtensionIds.length) {
				const newExtElement = new SettingsTreeNewExtensionsElement('newExtensions', resultExtensionIds);
				newExtElement.parent = this._root;
				this._root.children.push(newExtElement);
			}
		}
	}

	setResult(order: SearchResultIdx, result: ISearchResult | null): void {
		this.cachedUniqueSearchResults.clear();
		this.newExtensionSearchResults = null;

		if (this.rawSearchResults && order === SearchResultIdx.Local) {
			delete this.rawSearchResults[SearchResultIdx.Remote];
		}

		this.rawSearchResults ??= [];
		if (!result) {
			delete this.rawSearchResults[order];
			return;
		}

		this.rawSearchResults[order] = result;
		this.updateChildren();
	}

	getUniqueResultsCount(): number {
		return this.searchResultCount ?? 0;
	}
}

export interface IParsedQuery {
	tags: string[];
	query: string;
	extensionFilters: string[];
	idFilters: string[];
	featureFilters: string[];
	languageFilter: string | undefined;
}

const tagRegex = /(^|\s)@tag:("([^"]*)"|[^"]\S*)/g;
const extensionRegex = /(^|\s)@ext:("([^"]*)"|[^"]\S*)?/g;
const featureRegex = /(^|\s)@feature:("([^"]*)"|[^"]\S*)?/g;
const idRegex = /(^|\s)@id:("([^"]*)"|[^"]\S*)?/g;
const languageRegex = /(^|\s)@lang:("([^"]*)"|[^"]\S*)?/g;

export function parseQuery(query: string): IParsedQuery {
	function getTagsForType(query: string, filterRegex: RegExp, parsedParts: string[]): string {
		return query.replace(filterRegex, (_, __, quotedParsedElement, unquotedParsedElement) => {
			const parsedElement: string = unquotedParsedElement || quotedParsedElement;
			if (parsedElement) {
				parsedParts.push(...parsedElement.split(',').map(s => s.trim()).filter(s => !isFalsyOrWhitespace(s)));
			}
			return '';
		});
	}

	const tags: string[] = [];
	query = query.replace(tagRegex, (_, __, quotedTag, tag) => {
		tags.push(tag || quotedTag);
		return '';
	});

	query = query.replace(`@${MODIFIED_SETTING_TAG}`, () => {
		tags.push(MODIFIED_SETTING_TAG);
		return '';
	});

	query = query.replace(`@${POLICY_SETTING_TAG}`, () => {
		tags.push(POLICY_SETTING_TAG);
		return '';
	});

	query = query.replace(/@stable/g, () => {
		tags.push('stable');
		return '';
	});

	const extensions: string[] = [];
	const features: string[] = [];
	const ids: string[] = [];
	const langs: string[] = [];
	query = getTagsForType(query, extensionRegex, extensions);
	query = getTagsForType(query, featureRegex, features);
	query = getTagsForType(query, idRegex, ids);

	if (ENABLE_LANGUAGE_FILTER) {
		query = getTagsForType(query, languageRegex, langs);
	}

	query = query.trim();

	return {
		tags,
		extensionFilters: extensions,
		featureFilters: features,
		idFilters: ids,
		languageFilter: langs.length ? langs[0] : undefined,
		query,
	};
}
