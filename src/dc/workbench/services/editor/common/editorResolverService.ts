/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from '../../../../base/common/glob.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { posix } from '../../../../base/common/path.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IResourceEditorInput, ITextResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorInputWithOptions, EditorInputWithOptionsAndGroup, IResourceDiffEditorInput, IResourceMultiDiffEditorInput, IResourceMergeEditorInput, IUntitledTextResourceEditorInput, IUntypedEditorInput } from '../../../common/editor.js';
import { IEditorGroup } from './editorGroupsService.js';
import { PreferredGroup } from './editorService.js';
import { AtLeastOne } from '../../../../base/common/types.js';

export const IEditorResolverService = createDecorator<IEditorResolverService>('editorResolverService');



export type EditorAssociation = {
	readonly viewType: string;
	readonly filenamePattern?: string;
};

export type EditorAssociations = readonly EditorAssociation[];

export const editorsAssociationsSettingId = 'workbench.editorAssociations';
export const diffEditorsAssociationsSettingId = 'workbench.diffEditorAssociations';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

const editorAssociationsConfigurationNode: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	properties: {
		[editorsAssociationsSettingId]: {
			type: 'object',
			markdownDescription: localize('editor.editorAssociations', "Configure [glob patterns](https://www.dardcor-code.web.id/docs/configuration/glob-patterns) to editors (for example `\"*.hex\": \"hexEditor.hexedit\"`). These have precedence over the default behavior."),
			additionalProperties: {
				type: 'string'
			}
		},
		[diffEditorsAssociationsSettingId]: {
			type: 'object',
			markdownDescription: localize('editor.diffEditorAssociations', "Configure [glob patterns](https://www.dardcor-code.web.id/docs/configuration/glob-patterns) to editors for diff views (for example `\"*.md\": \"vscode.markdown.preview.editor\"`). These override `workbench.editorAssociations` for diffs."),
			additionalProperties: {
				type: 'string'
			}
		}
	}
};

export interface IEditorType {
	readonly id: string;
	readonly displayName: string;
	readonly providerDisplayName: string;
}

configurationRegistry.registerConfiguration(editorAssociationsConfigurationNode);

export enum RegisteredEditorPriority {
	builtin = 'builtin',
	option = 'option',
	exclusive = 'exclusive',
	default = 'default',
	explicit = 'explicit'
}

export const enum ResolvedStatus {
	ABORT = 1,
	NONE = 2,
}

export type ResolvedEditor = EditorInputWithOptionsAndGroup | ResolvedStatus;

export type RegisteredEditorOptions = {
	singlePerResource?: boolean | (() => boolean);

	canSupportResource?: (resource: URI) => boolean;
};

export type RegisteredEditorPriorityInfo = {
	readonly editor: RegisteredEditorPriority;
	readonly diff: RegisteredEditorPriority;
	readonly merge: RegisteredEditorPriority;
};

export type RegisteredEditorPriorityConfiguration = Omit<RegisteredEditorPriorityInfo, 'merge'> & {
	readonly merge?: RegisteredEditorPriority;
};

export type RegisteredEditorInfo = {
	readonly id: string;
	readonly label: string;
	readonly detail?: string;
	readonly priority: RegisteredEditorPriorityInfo;
};

export type RegisteredEditorRegistrationInfo = Omit<RegisteredEditorInfo, 'priority'> & {
	readonly priority: RegisteredEditorPriority | RegisteredEditorPriorityConfiguration;
};

export function toRegisteredEditorPriorityInfo(priority: RegisteredEditorPriority | RegisteredEditorPriorityConfiguration): RegisteredEditorPriorityInfo {
	if (typeof priority !== 'string') {
		return {
			editor: priority.editor,
			diff: priority.diff,
			merge: priority.merge ?? priority.editor,
		};
	}
	return {
		editor: priority,
		diff: priority,
		merge: priority,
	};
}

type EditorInputFactoryResult = EditorInputWithOptions | Promise<EditorInputWithOptions>;

export type EditorInputFactoryFunction = (editorInput: IResourceEditorInput | ITextResourceEditorInput, group: IEditorGroup) => EditorInputFactoryResult;

export type UntitledEditorInputFactoryFunction = (untitledEditorInput: IUntitledTextResourceEditorInput, group: IEditorGroup) => EditorInputFactoryResult;

export type DiffEditorInputFactoryFunction = (diffEditorInput: IResourceDiffEditorInput, group: IEditorGroup) => EditorInputFactoryResult;

export type MultiDiffEditorInputFactoryFunction = (multiDiffEditorInput: IResourceMultiDiffEditorInput, group: IEditorGroup) => EditorInputFactoryResult;

export type MergeEditorInputFactoryFunction = (mergeEditorInput: IResourceMergeEditorInput, group: IEditorGroup) => EditorInputFactoryResult;

type EditorInputFactories = {
	createEditorInput?: EditorInputFactoryFunction;
	createUntitledEditorInput?: UntitledEditorInputFactoryFunction;
	createDiffEditorInput?: DiffEditorInputFactoryFunction;
	createMultiDiffEditorInput?: MultiDiffEditorInputFactoryFunction;
	createMergeEditorInput?: MergeEditorInputFactoryFunction;
};

export type EditorInputFactoryObject = AtLeastOne<EditorInputFactories>;

export interface IEditorResolverService {
	readonly _serviceBrand: undefined;
	getAssociationsForResource(resource: URI): EditorAssociations;

	getConfiguredDefaultEditor(resource: URI, forDiffEditor?: boolean): string | undefined;

	updateUserAssociations(globPattern: string, editorID: string, forDiffEditor?: boolean): void;

	readonly onDidChangeEditorRegistrations: Event<void>;

	bufferChangeEvents(callback: Function): void;

	registerEditor(
		globPattern: string | glob.IRelativePattern,
		editorInfo: RegisteredEditorRegistrationInfo,
		options: RegisteredEditorOptions,
		editorFactoryObject: EditorInputFactoryObject
	): IDisposable;

	resolveEditor(editor: IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): Promise<ResolvedEditor>;

	getEditors(resource: URI): RegisteredEditorInfo[];

	getEditors(): RegisteredEditorInfo[];

	getBinaryDiffFallbackEditor(resource: URI): string | undefined;

	getAllUserAssociations(): EditorAssociations;
}


export function priorityToRank(priority: RegisteredEditorPriority): number {
	switch (priority) {
		case RegisteredEditorPriority.exclusive:
			return 5;
		case RegisteredEditorPriority.default:
			return 4;
		case RegisteredEditorPriority.builtin:
			return 3;
		case RegisteredEditorPriority.option:
			return 1;
		case RegisteredEditorPriority.explicit:
			return 0;
		default:
			return 1;
	}
}

export function globMatchesResource(globPattern: string | glob.IRelativePattern, resource: URI): boolean {
	const excludedSchemes = new Set([
		Schemas.extension,
		Schemas.webviewPanel,
		Schemas.vscodeWorkspaceTrust,
		Schemas.vscodeSettings
	]);
	if (excludedSchemes.has(resource.scheme)) {
		return false;
	}
	const matchOnPath = typeof globPattern === 'string' && globPattern.indexOf(posix.sep) >= 0;
	const target = matchOnPath ? `${resource.scheme}:${resource.path}` : basename(resource);
	return glob.match(globPattern, target, { ignoreCase: true });
}
