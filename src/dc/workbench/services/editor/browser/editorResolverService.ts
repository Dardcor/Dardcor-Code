/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct, insert } from '../../../../base/common/arrays.js';
import { PauseableEmitter } from '../../../../base/common/event.js';
import * as glob from '../../../../base/common/glob.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename, extname, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { EditorActivation, EditorResolution, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IKeyMods, IQuickInputService, IQuickPickItem, IQuickPickSeparator, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorInputWithOptions, EditorResourceAccessor, IResourceSideBySideEditorInput, isEditorInputWithOptions, isEditorInputWithOptionsAndGroup, isResourceDiffEditorInput, isResourceMergeEditorInput, isResourceMultiDiffEditorInput, isResourceSideBySideEditorInput, isUntitledResourceEditorInput, IUntypedEditorInput, SideBySideEditor } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { SideBySideEditorInput } from '../../../common/editor/sideBySideEditorInput.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { findGroup } from '../common/editorGroupFinder.js';
import { IEditorGroup, IEditorGroupsService } from '../common/editorGroupsService.js';
import { diffEditorsAssociationsSettingId, EditorAssociation, EditorAssociations, EditorInputFactoryObject, editorsAssociationsSettingId, globMatchesResource, IEditorResolverService, priorityToRank, RegisteredEditorInfo, RegisteredEditorOptions, RegisteredEditorPriority, RegisteredEditorRegistrationInfo, ResolvedEditor, ResolvedStatus, toRegisteredEditorPriorityInfo } from '../common/editorResolverService.js';
import { PreferredGroup } from '../common/editorService.js';

interface RegisteredEditor {
	globPattern: string | glob.IRelativePattern;
	editorInfo: RegisteredEditorInfo;
	options?: RegisteredEditorOptions;
	editorFactoryObject: EditorInputFactoryObject;
}

type RegisteredEditors = Array<RegisteredEditor>;

function normalizeRegisteredEditorInfo(editorInfo: RegisteredEditorRegistrationInfo): RegisteredEditorInfo {
	return {
		id: editorInfo.id,
		label: editorInfo.label,
		detail: editorInfo.detail,
		priority: toRegisteredEditorPriorityInfo(editorInfo.priority),
	};
}

const enum EditorAssociationType {
	Editor,
	DiffEditor,
	MergeEditor
}

export class EditorResolverService extends Disposable implements IEditorResolverService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeEditorRegistrations = this._register(new PauseableEmitter<void>());
	readonly onDidChangeEditorRegistrations = this._onDidChangeEditorRegistrations.event;

	private static readonly configureDefaultID = 'promptOpenWith.configureDefault';
	private static readonly configureDefaultDiffID = 'promptOpenWith.configureDefaultDiff';
	private static readonly cacheStorageID = 'editorOverrideService.cache';
	private static readonly conflictingDefaultsStorageID = 'editorOverrideService.conflictingDefaults';

	private _editors: Map<string | glob.IRelativePattern, Map<string, RegisteredEditors>> = new Map<string | glob.IRelativePattern, Map<string, RegisteredEditors>>();
	private _flattenedEditors: Map<string | glob.IRelativePattern, RegisteredEditors> = new Map();
	private _shouldReFlattenEditors = true;
	private cache: Set<string> | undefined;

	constructor(
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.cache = new Set<string>(JSON.parse(this.storageService.get(EditorResolverService.cacheStorageID, StorageScope.PROFILE, JSON.stringify([]))));
		this.storageService.remove(EditorResolverService.cacheStorageID, StorageScope.PROFILE);

		this._register(this.storageService.onWillSaveState(() => {
			this.cacheEditors();
		}));

		this._register(this.extensionService.onDidRegisterExtensions(() => {
			this.cache = undefined;
		}));
	}

	private resolveUntypedInputAndGroup(editor: IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): Promise<[IUntypedEditorInput, IEditorGroup, EditorActivation | undefined] | undefined> | [IUntypedEditorInput, IEditorGroup, EditorActivation | undefined] | undefined {
		const untypedEditor = editor;

		const findGroupResult = this.instantiationService.invokeFunction(findGroup, untypedEditor, preferredGroup);
		if (findGroupResult instanceof Promise) {
			return findGroupResult.then(([group, activation]) => [untypedEditor, group, activation]);
		} else {
			const [group, activation] = findGroupResult;
			return [untypedEditor, group, activation];
		}
	}

	async resolveEditor(editor: IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): Promise<ResolvedEditor> {
		this._flattenedEditors = this._flattenEditorsMap();

		if (isResourceSideBySideEditorInput(editor)) {
			return this.doResolveSideBySideEditor(editor, preferredGroup);
		}

		let resolvedUntypedAndGroup: [IUntypedEditorInput, IEditorGroup, EditorActivation | undefined] | undefined;
		const resolvedUntypedAndGroupResult = this.resolveUntypedInputAndGroup(editor, preferredGroup);
		if (resolvedUntypedAndGroupResult instanceof Promise) {
			resolvedUntypedAndGroup = await resolvedUntypedAndGroupResult;
		} else {
			resolvedUntypedAndGroup = resolvedUntypedAndGroupResult;
		}

		if (!resolvedUntypedAndGroup) {
			return ResolvedStatus.NONE;
		}
		const [untypedEditor, group, activation] = resolvedUntypedAndGroup;
		if (activation) {
			untypedEditor.options = { ...untypedEditor.options, activation };
		}

		let resource = EditorResourceAccessor.getCanonicalUri(untypedEditor, { supportSideBySide: SideBySideEditor.PRIMARY });

		const editorAssociationType = isResourceDiffEditorInput(untypedEditor) ? EditorAssociationType.DiffEditor : isResourceMergeEditorInput(untypedEditor) ? EditorAssociationType.MergeEditor : EditorAssociationType.Editor;
		if (this.cache && resource && (this.resourceMatchesCache(resource) || this.resourceMatchesUserAssociation(resource, editorAssociationType))) {
			await this.extensionService.whenInstalledExtensionsRegistered();
		}

		if (resource === undefined) {
			resource = URI.from({ scheme: Schemas.untitled });
		} else if (resource.scheme === undefined || resource === null) {
			return ResolvedStatus.NONE;
		}

		if (untypedEditor.options?.override === EditorResolution.PICK) {
			const picked = await this.doPickEditor(untypedEditor);
			if (!picked) {
				return ResolvedStatus.ABORT;
			}
			untypedEditor.options = picked;
		}

		let { editor: selectedEditor, conflictingDefault } = this.getEditor(resource, untypedEditor.options?.override as (string | EditorResolution.EXCLUSIVE_ONLY | undefined), editorAssociationType);
		if (!selectedEditor && (untypedEditor.options?.override || isEditorInputWithOptions(editor))) {
			return ResolvedStatus.NONE;
		} else if (!selectedEditor) {
			const resolvedEditor = this.getEditor(resource, DEFAULT_EDITOR_ASSOCIATION.id, editorAssociationType);
			selectedEditor = resolvedEditor?.editor;
			conflictingDefault = resolvedEditor?.conflictingDefault;
			if (!selectedEditor) {
				return ResolvedStatus.NONE;
			}
		}

		if (isResourceDiffEditorInput(untypedEditor) && untypedEditor.options?.override === undefined) {
			let resource2 = EditorResourceAccessor.getCanonicalUri(untypedEditor, { supportSideBySide: SideBySideEditor.SECONDARY });
			if (!resource2) {
				resource2 = URI.from({ scheme: Schemas.untitled });
			}
			const { editor: selectedEditor2 } = this.getEditor(resource2, undefined, editorAssociationType);
			if (!selectedEditor2 || selectedEditor.editorInfo.id !== selectedEditor2.editorInfo.id) {
				const { editor: selectedDiff, conflictingDefault: conflictingDefaultDiff } = this.getEditor(resource, DEFAULT_EDITOR_ASSOCIATION.id, editorAssociationType);
				selectedEditor = selectedDiff;
				conflictingDefault = conflictingDefaultDiff;
			}
			if (!selectedEditor) {
				return ResolvedStatus.NONE;
			}
		}

		untypedEditor.options = { override: selectedEditor.editorInfo.id, ...untypedEditor.options };

		if (selectedEditor.editorFactoryObject.createDiffEditorInput === undefined && isResourceDiffEditorInput(untypedEditor)) {
			return ResolvedStatus.NONE;
		}

		const input = await this.doResolveEditor(untypedEditor, group, selectedEditor);
		if (conflictingDefault && input) {
			await this.doHandleConflictingDefaults(resource, selectedEditor.editorInfo.label, untypedEditor, input.editor, group);
		}

		if (input) {
			if (input.editor.editorId !== selectedEditor.editorInfo.id) {
				this.logService.warn(`Editor ID Mismatch: ${input.editor.editorId} !== ${selectedEditor.editorInfo.id}. This will cause bugs. Please ensure editorInput.editorId matches the registered id`);
			}
			return { ...input, group };
		}
		return ResolvedStatus.ABORT;
	}

	private async doResolveSideBySideEditor(editor: IResourceSideBySideEditorInput, preferredGroup: PreferredGroup | undefined): Promise<ResolvedEditor> {
		const primaryResolvedEditor = await this.resolveEditor(editor.primary, preferredGroup);
		if (!isEditorInputWithOptionsAndGroup(primaryResolvedEditor)) {
			return ResolvedStatus.NONE;
		}
		const secondaryResolvedEditor = await this.resolveEditor(editor.secondary, primaryResolvedEditor.group ?? preferredGroup);
		if (!isEditorInputWithOptionsAndGroup(secondaryResolvedEditor)) {
			return ResolvedStatus.NONE;
		}
		return {
			group: primaryResolvedEditor.group ?? secondaryResolvedEditor.group,
			editor: this.instantiationService.createInstance(SideBySideEditorInput, editor.label, editor.description, secondaryResolvedEditor.editor, primaryResolvedEditor.editor),
			options: editor.options
		};
	}

	bufferChangeEvents(callback: Function): void {
		this._onDidChangeEditorRegistrations.pause();
		try {
			callback();
		} finally {
			this._onDidChangeEditorRegistrations.resume();
		}
	}

	registerEditor(
		globPattern: string | glob.IRelativePattern,
		editorInfo: RegisteredEditorRegistrationInfo,
		options: RegisteredEditorOptions,
		editorFactoryObject: EditorInputFactoryObject
	): IDisposable {
		const registeredEditorInfo = normalizeRegisteredEditorInfo(editorInfo);
		let registeredEditor = this._editors.get(globPattern);
		if (registeredEditor === undefined) {
			registeredEditor = new Map<string, RegisteredEditors>();
			this._editors.set(globPattern, registeredEditor);
		}

		let editorsWithId = registeredEditor.get(registeredEditorInfo.id);
		if (editorsWithId === undefined) {
			editorsWithId = [];
		}
		const remove = insert(editorsWithId, {
			globPattern,
			editorInfo: registeredEditorInfo,
			options,
			editorFactoryObject
		});
		registeredEditor.set(registeredEditorInfo.id, editorsWithId);
		this._shouldReFlattenEditors = true;
		this._onDidChangeEditorRegistrations.fire();
		return toDisposable(() => {
			remove();
			if (editorsWithId && editorsWithId.length === 0) {
				registeredEditor?.delete(editorInfo.id);
			}
			this._shouldReFlattenEditors = true;
			this._onDidChangeEditorRegistrations.fire();
		});
	}

	getAssociationsForResource(resource: URI): EditorAssociations {
		return this.getAssociationsForResourceFromSetting(resource, editorsAssociationsSettingId);
	}

	getConfiguredDefaultEditor(resource: URI, forDiffEditor?: boolean): string | undefined {
		const settingId = forDiffEditor ? diffEditorsAssociationsSettingId : editorsAssociationsSettingId;
		return this.getAssociationsForResourceFromSetting(resource, settingId)[0]?.viewType;
	}

	private getAssociationsForResourceByType(resource: URI, associationType: EditorAssociationType): EditorAssociations {
		if (associationType === EditorAssociationType.Editor) {
			return this.getAssociationsForResource(resource);
		}

		const modeAssociations = this.getAssociationsForResourceFromSetting(resource, diffEditorsAssociationsSettingId);
		if (modeAssociations.length) {
			return modeAssociations;
		}

		return this.getAssociationsForResource(resource)
			.filter(association => !this.isExplicitForAssociationType(association.viewType, associationType));
	}

	private isExplicitForAssociationType(viewType: string, associationType: EditorAssociationType): boolean {
		const editor = this._registeredEditors.filter(editor => editor.editorInfo.id === viewType).at(0);
		return !!editor && this.getEffectivePriority(editor.editorInfo, associationType) === RegisteredEditorPriority.explicit;
	}

	private getAssociationsForResourceFromSetting(resource: URI, settingId: string): EditorAssociations {
		const matchingAssociations = this.getRawAssociationsForResourceFromSetting(resource, settingId);
		const allEditors: RegisteredEditors = this._registeredEditors;
		return matchingAssociations.filter(association => allEditors.find(c => c.editorInfo.id === association.viewType));
	}

	private getRawAssociationsForResourceByType(resource: URI, associationType: EditorAssociationType): EditorAssociations {
		if (associationType === EditorAssociationType.Editor) {
			return this.getRawAssociationsForResourceFromSetting(resource, editorsAssociationsSettingId);
		}

		const diffAssociations = this.getRawAssociationsForResourceFromSetting(resource, diffEditorsAssociationsSettingId);
		return diffAssociations.length ? diffAssociations : this.getRawAssociationsForResourceFromSetting(resource, editorsAssociationsSettingId);
	}

	private getRawAssociationsForResourceFromSetting(resource: URI, settingId: string): EditorAssociations {
		const associations = this.getAllUserAssociationsForSetting(settingId);
		const matchingAssociations = associations.filter(association => association.filenamePattern && globMatchesResource(association.filenamePattern, resource));
		return matchingAssociations.sort((a, b) => (b.filenamePattern?.length ?? 0) - (a.filenamePattern?.length ?? 0));
	}

	getAllUserAssociations(): EditorAssociations {
		return this.getAllUserAssociationsForSetting(editorsAssociationsSettingId);
	}

	private getAllUserAssociationsForSetting(settingId: string): EditorAssociations {
		const inspectedEditorAssociations = this.configurationService.inspect<{ [fileNamePattern: string]: string }>(settingId) || {};
		const defaultAssociations = inspectedEditorAssociations.defaultValue ?? {};
		const workspaceAssociations = inspectedEditorAssociations.workspaceValue ?? {};
		const userAssociations = inspectedEditorAssociations.userValue ?? {};
		const rawAssociations: { [fileNamePattern: string]: string } = { ...workspaceAssociations };
		for (const [key, value] of Object.entries({ ...defaultAssociations, ...userAssociations })) {
			if (rawAssociations[key] === undefined) {
				rawAssociations[key] = value;
			}
		}
		const associations = [];
		for (const [key, value] of Object.entries(rawAssociations)) {
			const association: EditorAssociation = {
				filenamePattern: key,
				viewType: value
			};
			associations.push(association);
		}
		return associations;
	}

	private _flattenEditorsMap() {
		if (!this._shouldReFlattenEditors) {
			return this._flattenedEditors;
		}
		this._shouldReFlattenEditors = false;
		const editors = new Map<string | glob.IRelativePattern, RegisteredEditors>();
		for (const [glob, value] of this._editors) {
			const registeredEditors: RegisteredEditors = [];
			for (const editors of value.values()) {
				let registeredEditor: RegisteredEditor | undefined = undefined;
				for (const editor of editors) {
					if (!registeredEditor) {
						registeredEditor = {
							editorInfo: editor.editorInfo,
							globPattern: editor.globPattern,
							options: {},
							editorFactoryObject: {}
						};
					}
					registeredEditor.options = { ...registeredEditor.options, ...editor.options };
					registeredEditor.editorFactoryObject = { ...registeredEditor.editorFactoryObject, ...editor.editorFactoryObject };
				}
				if (registeredEditor) {
					registeredEditors.push(registeredEditor);
				}
			}
			editors.set(glob, registeredEditors);
		}
		return editors;
	}

	private get _registeredEditors(): RegisteredEditors {
		return Array.from(this._flattenedEditors.values()).flat();
	}

	updateUserAssociations(globPattern: string, editorID: string, forDiffEditor?: boolean): void {
		this.updateUserAssociationsForSetting(forDiffEditor ? diffEditorsAssociationsSettingId : editorsAssociationsSettingId, globPattern, editorID);
	}

	private updateUserAssociationsForType(associationType: EditorAssociationType, globPattern: string, editorID: string): void {
		this.updateUserAssociationsForSetting(associationType === EditorAssociationType.DiffEditor ? diffEditorsAssociationsSettingId : editorsAssociationsSettingId, globPattern, editorID);
	}

	private updateUserAssociationsForSetting(settingId: string, globPattern: string, editorID: string): void {
		const newAssociation: EditorAssociation = { viewType: editorID, filenamePattern: globPattern };
		const currentAssociations = this.getAllUserAssociationsForSetting(settingId);
		const newSettingObject = Object.create(null);
		for (const association of [...currentAssociations, newAssociation]) {
			if (association.filenamePattern) {
				newSettingObject[association.filenamePattern] = association.viewType;
			}
		}
		this.configurationService.updateValue(settingId, newSettingObject);
	}

	private removeUserAssociationForSetting(settingId: string, globPattern: string): void {
		const currentAssociations = this.getAllUserAssociationsForSetting(settingId);
		if (!currentAssociations.some(association => association.filenamePattern === globPattern)) {
			return;
		}
		const newSettingObject = Object.create(null);
		for (const association of currentAssociations) {
			if (association.filenamePattern && association.filenamePattern !== globPattern) {
				newSettingObject[association.filenamePattern] = association.viewType;
			}
		}
		this.configurationService.updateValue(settingId, newSettingObject);
	}

	private findMatchingEditors(resource: URI, associationType: EditorAssociationType = EditorAssociationType.Editor): RegisteredEditor[] {
		const userSettings = this.getAssociationsForResourceByType(resource, associationType);
		const matchingEditors: RegisteredEditor[] = [];
		for (const [key, editors] of this._flattenedEditors) {
			for (const editor of editors) {
				if (associationType === EditorAssociationType.DiffEditor && !editor.editorFactoryObject.createDiffEditorInput) {
					continue;
				}
				if (associationType === EditorAssociationType.MergeEditor && !editor.editorFactoryObject.createMergeEditorInput) {
					continue;
				}

				const foundInSettings = userSettings.find(setting => setting.viewType === editor.editorInfo.id);
				if ((foundInSettings && this.getEffectivePriority(editor.editorInfo, associationType) !== RegisteredEditorPriority.exclusive) || globMatchesResource(key, resource)) {
					matchingEditors.push(editor);
				}
			}
		}
		return matchingEditors.sort((a, b) => {
			const aPriority = this.getEffectivePriority(a.editorInfo, associationType);
			const bPriority = this.getEffectivePriority(b.editorInfo, associationType);
			if (priorityToRank(bPriority) === priorityToRank(aPriority) && typeof b.globPattern === 'string' && typeof a.globPattern === 'string') {
				return b.globPattern.length - a.globPattern.length;
			}
			return priorityToRank(bPriority) - priorityToRank(aPriority);
		});
	}

	public getEditors(resource?: URI): RegisteredEditorInfo[] {
		this._flattenedEditors = this._flattenEditorsMap();

		if (URI.isUri(resource)) {
			const editors = this.findMatchingEditors(resource);
			if (editors.find(e => e.editorInfo.priority.editor === RegisteredEditorPriority.exclusive)) {
				return [];
			}
			return editors.map(editor => editor.editorInfo);
		}

		return distinct(this._registeredEditors.map(editor => editor.editorInfo), editor => editor.id);
	}

	getBinaryDiffFallbackEditor(resource: URI): string | undefined {
		this._flattenedEditors = this._flattenEditorsMap();

		const editors = this.findMatchingEditors(resource, EditorAssociationType.DiffEditor)
			.filter(editor => editor.editorInfo.id !== DEFAULT_EDITOR_ASSOCIATION.id);
		return editors[0]?.editorInfo.id;
	}

	private getEditor(resource: URI, editorId: string | EditorResolution.EXCLUSIVE_ONLY | undefined, associationType: EditorAssociationType): { editor: RegisteredEditor | undefined; conflictingDefault: boolean } {

		const findMatchingEditor = (editors: RegisteredEditors, viewType: string) => {
			return editors.find((editor) => {
				if (associationType === EditorAssociationType.DiffEditor && !editor.editorFactoryObject.createDiffEditorInput) {
					return false;
				}
				if (associationType === EditorAssociationType.MergeEditor && !editor.editorFactoryObject.createMergeEditorInput) {
					return false;
				}

				if (editor.options?.canSupportResource !== undefined) {
					return editor.editorInfo.id === viewType && editor.options.canSupportResource(resource);
				}
				return editor.editorInfo.id === viewType;
			});
		};

		if (editorId && editorId !== EditorResolution.EXCLUSIVE_ONLY) {
			const registeredEditors = this._registeredEditors;
			return {
				editor: findMatchingEditor(registeredEditors, editorId),
				conflictingDefault: false
			};
		}

		const editors = this.findMatchingEditors(resource, associationType);

		const associationsFromSetting = this.getAssociationsForResourceByType(resource, associationType);
		const minPriority = editorId === EditorResolution.EXCLUSIVE_ONLY ? RegisteredEditorPriority.exclusive : RegisteredEditorPriority.builtin;
		let possibleEditors = editors.filter(editor => priorityToRank(this.getEffectivePriority(editor.editorInfo, associationType)) >= priorityToRank(minPriority) && editor.editorInfo.id !== DEFAULT_EDITOR_ASSOCIATION.id);
		if (possibleEditors.length === 0) {
			return {
				editor: associationsFromSetting[0] && minPriority !== RegisteredEditorPriority.exclusive ? findMatchingEditor(editors, associationsFromSetting[0].viewType) : undefined,
				conflictingDefault: false
			};
		}
		const selectedViewType = this.getEffectivePriority(possibleEditors[0].editorInfo, associationType) === RegisteredEditorPriority.exclusive ?
			possibleEditors[0].editorInfo.id :
			associationsFromSetting[0]?.viewType ||
			(possibleEditors.find(editor => (!editor.options?.canSupportResource || editor.options.canSupportResource(resource)))?.editorInfo.id) ||
			possibleEditors[0].editorInfo.id;

		let conflictingDefault = false;

		possibleEditors = possibleEditors
			.filter(editor => this.getEffectivePriority(editor.editorInfo, associationType) !== RegisteredEditorPriority.exclusive)
			.filter(editor => !editor.options?.canSupportResource || editor.options.canSupportResource(resource));
		if (associationsFromSetting.length === 0 && possibleEditors.length > 1) {
			conflictingDefault = true;
		}

		return {
			editor: findMatchingEditor(editors, selectedViewType),
			conflictingDefault
		};
	}

	private getEffectivePriority(editorInfo: RegisteredEditorInfo, associationType: EditorAssociationType): RegisteredEditorPriority {
		switch (associationType) {
			case EditorAssociationType.DiffEditor:
				return editorInfo.priority.diff;
			case EditorAssociationType.MergeEditor:
				return editorInfo.priority.merge;
			default:
				return editorInfo.priority.editor;
		}
	}

	private async doResolveEditor(editor: IUntypedEditorInput, group: IEditorGroup, selectedEditor: RegisteredEditor): Promise<EditorInputWithOptions | undefined> {
		let options = editor.options;
		const resource = EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (options && typeof options.activation === 'undefined') {
			options = { ...options, activation: options.preserveFocus ? EditorActivation.RESTORE : undefined };
		}

		if (isResourceMergeEditorInput(editor)) {
			if (!selectedEditor.editorFactoryObject.createMergeEditorInput) {
				return;
			}
			const inputWithOptions = await selectedEditor.editorFactoryObject.createMergeEditorInput(editor, group);
			return { editor: inputWithOptions.editor, options: inputWithOptions.options ?? options };
		}

		if (isResourceDiffEditorInput(editor)) {
			if (!selectedEditor.editorFactoryObject.createDiffEditorInput) {
				return;
			}
			const inputWithOptions = await selectedEditor.editorFactoryObject.createDiffEditorInput(editor, group);
			return { editor: inputWithOptions.editor, options: inputWithOptions.options ?? options };
		}

		if (isResourceMultiDiffEditorInput(editor)) {
			if (!selectedEditor.editorFactoryObject.createMultiDiffEditorInput) {
				return;
			}
			const inputWithOptions = await selectedEditor.editorFactoryObject.createMultiDiffEditorInput(editor, group);
			return { editor: inputWithOptions.editor, options: inputWithOptions.options ?? options };
		}

		if (isResourceSideBySideEditorInput(editor)) {
			throw new Error(`Untyped side by side editor input not supported here.`);
		}

		if (isUntitledResourceEditorInput(editor)) {
			if (!selectedEditor.editorFactoryObject.createUntitledEditorInput) {
				return;
			}
			const inputWithOptions = await selectedEditor.editorFactoryObject.createUntitledEditorInput(editor, group);
			return { editor: inputWithOptions.editor, options: inputWithOptions.options ?? options };
		}

		if (resource === undefined) {
			throw new Error(`Undefined resource on non untitled editor input.`);
		}

		const singleEditorPerResource = typeof selectedEditor.options?.singlePerResource === 'function' ? selectedEditor.options.singlePerResource() : selectedEditor.options?.singlePerResource;
		if (singleEditorPerResource) {
			const existingEditors = this.findExistingEditorsForResource(resource, selectedEditor.editorInfo.id);
			if (existingEditors.length) {
				const editor = await this.moveExistingEditorForResource(existingEditors, group);
				if (editor) {
					return { editor, options };
				} else {
					return;
				}
			}
		}

		if (!selectedEditor.editorFactoryObject.createEditorInput) {
			return;
		}

		const inputWithOptions = await selectedEditor.editorFactoryObject.createEditorInput(editor, group);
		options = inputWithOptions.options ?? options;
		const input = inputWithOptions.editor;

		return { editor: input, options };
	}

	private async moveExistingEditorForResource(
		existingEditorsForResource: Array<{ editor: EditorInput; group: IEditorGroup }>,
		targetGroup: IEditorGroup,
	): Promise<EditorInput | undefined> {
		const editorToUse = existingEditorsForResource[0];

		for (const { editor, group } of existingEditorsForResource) {
			if (editor !== editorToUse.editor) {
				const closed = await group.closeEditor(editor);
				if (!closed) {
					return;
				}
			}
		}

		if (targetGroup.id !== editorToUse.group.id) {
			const moved = editorToUse.group.moveEditor(editorToUse.editor, targetGroup);
			if (!moved) {
				return;
			}
		}

		return editorToUse.editor;
	}

	private findExistingEditorsForResource(
		resource: URI,
		editorId: string,
	): Array<{ editor: EditorInput; group: IEditorGroup }> {
		const out: Array<{ editor: EditorInput; group: IEditorGroup }> = [];
		const orderedGroups = distinct([
			...this.editorGroupService.groups,
		]);

		for (const group of orderedGroups) {
			for (const editor of group.editors) {
				if (isEqual(editor.resource, resource) && editor.editorId === editorId) {
					out.push({ editor, group });
				}
			}
		}
		return out;
	}

	private async doHandleConflictingDefaults(resource: URI, editorName: string, untypedInput: IUntypedEditorInput, currentEditor: EditorInput, group: IEditorGroup) {
		type StoredChoice = {
			[key: string]: string[];
		};
		const associationType = isResourceDiffEditorInput(untypedInput) ? EditorAssociationType.DiffEditor : isResourceMergeEditorInput(untypedInput) ? EditorAssociationType.MergeEditor : EditorAssociationType.Editor;
		const editors = this.findMatchingEditors(resource, associationType);
		const storedChoices: StoredChoice = JSON.parse(this.storageService.get(EditorResolverService.conflictingDefaultsStorageID, StorageScope.PROFILE, '{}'));
		const globForResource = `*${extname(resource)}`;
		const writeCurrentEditorsToStorage = () => {
			storedChoices[globForResource] = [];
			editors.forEach(editor => storedChoices[globForResource].push(editor.editorInfo.id));
			this.storageService.store(EditorResolverService.conflictingDefaultsStorageID, JSON.stringify(storedChoices), StorageScope.PROFILE, StorageTarget.MACHINE);
		};

		if (storedChoices[globForResource]?.find(editorID => editorID === currentEditor.editorId)) {
			return;
		}

		const handle = this.notificationService.prompt(Severity.Warning,
			localize('editorResolver.conflictingDefaults', 'There are multiple default editors available for the resource.'),
			[{
				label: localize('editorResolver.configureDefault', 'Configure Default'),
				run: async () => {
					const picked = await this.doPickEditor(untypedInput, true);
					if (!picked) {
						return;
					}
					untypedInput.options = picked;
					const replacementEditor = await this.resolveEditor(untypedInput, group);
					if (replacementEditor === ResolvedStatus.ABORT || replacementEditor === ResolvedStatus.NONE) {
						return;
					}
					group.replaceEditors([
						{
							editor: currentEditor,
							replacement: replacementEditor.editor,
							options: replacementEditor.options ?? picked,
						}
					]);
				}
			},
			{
				label: localize('editorResolver.keepDefault', 'Keep {0}', editorName),
				run: writeCurrentEditorsToStorage
			}
			]);
		const onCloseListener = handle.onDidClose(() => {
			writeCurrentEditorsToStorage();
			onCloseListener.dispose();
		});
	}

	private mapEditorsToQuickPickEntry(resource: URI, showDefaultPicker: boolean | undefined, associationType: EditorAssociationType) {
		const currentEditor = this.editorGroupService.activeGroup.findEditors(resource).at(0);
		let registeredEditors = resource.scheme === Schemas.untitled ? this._registeredEditors.filter(e => e.editorInfo.priority.editor !== RegisteredEditorPriority.exclusive) : this.findMatchingEditors(resource, associationType);
		if (associationType === EditorAssociationType.DiffEditor) {
			registeredEditors = registeredEditors.filter(editor => !!editor.editorFactoryObject.createDiffEditorInput);
		}
		registeredEditors = distinct(registeredEditors, c => c.editorInfo.id);
		const defaultSetting = this.getAssociationsForResourceByType(resource, associationType)[0]?.viewType;
		registeredEditors = registeredEditors.sort((a, b) => {
			if (a.editorInfo.id === DEFAULT_EDITOR_ASSOCIATION.id) {
				return -1;
			} else if (b.editorInfo.id === DEFAULT_EDITOR_ASSOCIATION.id) {
				return 1;
			} else {
				return priorityToRank(this.getEffectivePriority(b.editorInfo, associationType)) - priorityToRank(this.getEffectivePriority(a.editorInfo, associationType));
			}
		});
		const quickPickEntries: Array<QuickPickItem> = [];
		const currentlyActiveLabel = localize('promptOpenWith.currentlyActive', "Active");
		const currentDefaultLabel = localize('promptOpenWith.currentDefault', "Default");
		const currentDefaultAndActiveLabel = localize('promptOpenWith.currentDefaultAndActive', "Active and Default");
		let defaultViewType = defaultSetting;
		if (!defaultViewType && registeredEditors.length > 2 && this.getEffectivePriority(registeredEditors[1].editorInfo, associationType) !== RegisteredEditorPriority.option) {
			defaultViewType = registeredEditors[1]?.editorInfo.id;
		}
		if (!defaultViewType) {
			defaultViewType = DEFAULT_EDITOR_ASSOCIATION.id;
		}
		registeredEditors.forEach(editor => {
			const currentViewType = currentEditor?.editorId ?? DEFAULT_EDITOR_ASSOCIATION.id;
			const isActive = currentEditor ? editor.editorInfo.id === currentViewType : false;
			const isDefault = editor.editorInfo.id === defaultViewType;
			const quickPickEntry: IQuickPickItem = {
				id: editor.editorInfo.id,
				label: editor.editorInfo.label,
				description: isActive && isDefault ? currentDefaultAndActiveLabel : isActive ? currentlyActiveLabel : isDefault ? currentDefaultLabel : undefined,
				detail: editor.editorInfo.detail ?? editor.editorInfo.priority.editor,
			};
			quickPickEntries.push(quickPickEntry);
		});
		if (!showDefaultPicker && extname(resource) !== '') {
			const separator: IQuickPickSeparator = { type: 'separator' };
			quickPickEntries.push(separator);
			const configureDefaultEntry = {
				id: EditorResolverService.configureDefaultID,
				label: localize('promptOpenWith.configureDefault', "Configure default editor for '{0}'...", `*${extname(resource)}`),
			};
			quickPickEntries.push(configureDefaultEntry);
			if (associationType === EditorAssociationType.DiffEditor) {
				const configureDefaultDiffEntry = {
					id: EditorResolverService.configureDefaultDiffID,
					label: localize('promptOpenWith.configureDefaultDiff', "Configure default editor (diff only) for '{0}'...", `*${extname(resource)}`),
				};
				quickPickEntries.push(configureDefaultDiffEntry);
			}
		}
		return quickPickEntries;
	}

	private async doPickEditor(editor: IUntypedEditorInput, showDefaultPicker?: boolean, updateAssociationType?: EditorAssociationType): Promise<IEditorOptions | undefined> {

		type EditorPick = {
			readonly item: IQuickPickItem;
			readonly keyMods?: IKeyMods;
			readonly openInBackground: boolean;
		};

		let resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });

		if (resource === undefined) {
			resource = URI.from({ scheme: Schemas.untitled });
		}
		const associationType = isResourceDiffEditorInput(editor) ? EditorAssociationType.DiffEditor : EditorAssociationType.Editor;
		const updateSettingType = updateAssociationType ?? associationType;

		const persistDefaultAssociation = (editorID: string) => {
			const globPattern = `*${extname(resource)}`;
			this.updateUserAssociationsForType(updateSettingType, globPattern, editorID);
			if (updateSettingType === EditorAssociationType.Editor && associationType === EditorAssociationType.DiffEditor) {
				this.removeUserAssociationForSetting(diffEditorsAssociationsSettingId, globPattern);
			}
		};

		const editorPicks = this.mapEditorsToQuickPickEntry(resource, showDefaultPicker, associationType);

		const disposables = new DisposableStore();
		const editorPicker = disposables.add(this.quickInputService.createQuickPick<IQuickPickItem>({ useSeparators: true }));
		const placeHolderMessage = showDefaultPicker ?
			(updateSettingType === EditorAssociationType.DiffEditor ?
				localize('promptOpenWith.updateDefaultDiffPlaceHolder', "Select new default editor (diff only) for '{0}'", `*${extname(resource)}`) :
				localize('promptOpenWith.updateDefaultPlaceHolder', "Select new default editor for '{0}'", `*${extname(resource)}`)) :
			localize('promptOpenWith.placeHolder', "Select editor for '{0}'", basename(resource));
		editorPicker.placeholder = placeHolderMessage;
		editorPicker.canAcceptInBackground = true;
		editorPicker.items = editorPicks;
		const firstItem = editorPicker.items.find(item => item.type === 'item') as IQuickPickItem | undefined;
		if (firstItem) {
			editorPicker.selectedItems = [firstItem];
		}

		const picked: EditorPick | undefined = await new Promise<EditorPick | undefined>(resolve => {
			disposables.add(editorPicker.onDidAccept(e => {
				let result: EditorPick | undefined = undefined;

				if (editorPicker.selectedItems.length === 1) {
					result = {
						item: editorPicker.selectedItems[0],
						keyMods: editorPicker.keyMods,
						openInBackground: e.inBackground
					};
				}

				if (resource && showDefaultPicker && result?.item.id) {
					persistDefaultAssociation(result.item.id);
				}

				resolve(result);
			}));

			disposables.add(editorPicker.onDidHide(() => {
				disposables.dispose();
				resolve(undefined);
			}));

			disposables.add(editorPicker.onDidTriggerItemButton(e => {

				resolve({ item: e.item, openInBackground: false });

				if (resource && e.item?.id) {
					persistDefaultAssociation(e.item.id);
				}
			}));

			editorPicker.show();
		});

		editorPicker.dispose();

		if (picked) {

			if (picked.item.id === EditorResolverService.configureDefaultID) {
				return this.doPickEditor(editor, true, EditorAssociationType.Editor);
			}
			if (picked.item.id === EditorResolverService.configureDefaultDiffID) {
				return this.doPickEditor(editor, true, EditorAssociationType.DiffEditor);
			}

			const targetOptions: IEditorOptions = {
				...editor.options,
				override: picked.item.id,
				preserveFocus: picked.openInBackground || editor.options?.preserveFocus,
			};

			return targetOptions;
		}

		return undefined;
	}

	private cacheEditors() {
		const cacheStorage: Set<string> = new Set<string>();

		for (const [globPattern, contribPoint] of this._flattenedEditors) {
			const nonOptional = !!contribPoint.find(c => c.editorInfo.priority.editor !== RegisteredEditorPriority.option && c.editorInfo.id !== DEFAULT_EDITOR_ASSOCIATION.id);
			if (!nonOptional) {
				continue;
			}
			if (glob.isRelativePattern(globPattern)) {
				cacheStorage.add(`${globPattern.pattern}`);
			} else {
				cacheStorage.add(globPattern);
			}
		}

		const userAssociations = [
			...this.getAllUserAssociations(),
			...this.getAllUserAssociationsForSetting(diffEditorsAssociationsSettingId)
		];
		for (const association of userAssociations) {
			if (association.filenamePattern) {
				cacheStorage.add(association.filenamePattern);
			}
		}
		this.storageService.store(EditorResolverService.cacheStorageID, JSON.stringify(Array.from(cacheStorage)), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private resourceMatchesUserAssociation(resource: URI, associationType: EditorAssociationType): boolean {
		const userAssociations = this.getRawAssociationsForResourceByType(resource, associationType);
		for (const association of userAssociations) {
			if (association.viewType !== DEFAULT_EDITOR_ASSOCIATION.id) {
				return true;
			}
		}
		return false;
	}

	private resourceMatchesCache(resource: URI): boolean {
		if (!this.cache) {
			return false;
		}

		for (const cacheEntry of this.cache) {
			if (globMatchesResource(cacheEntry, resource)) {
				return true;
			}
		}
		return false;
	}
}

registerSingleton(IEditorResolverService, EditorResolverService, InstantiationType.Eager);
