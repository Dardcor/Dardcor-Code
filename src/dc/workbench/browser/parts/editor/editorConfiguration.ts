/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { diffEditorsAssociationsSettingId, editorsAssociationsSettingId, IEditorResolverService, RegisteredEditorInfo, RegisteredEditorPriority, toRegisteredEditorPriorityInfo } from '../../../services/editor/common/editorResolverService.js';
import { IJSONSchemaMap } from '../../../../base/common/jsonSchema.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { Event } from '../../../../base/common/event.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { ByteSize, getLargeFileConfirmationLimit } from '../../../../platform/files/common/files.js';

export class DynamicEditorConfigurations extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.dynamicEditorConfigurations';

	private static readonly AUTO_LOCK_DEFAULT_ENABLED = new Set<string>([
		'terminalEditor',
		'mainThreadWebview-simpleBrowser.view',
		'mainThreadWebview-browserPreview',
		'workbench.editor.processExplorer'
	]);

	private static readonly AUTO_LOCK_EXTRA_EDITORS: RegisteredEditorInfo[] = [


		{
			id: 'workbench.input.interactive',
			label: localize('interactiveWindow', 'Interactive Window'),
			priority: toRegisteredEditorPriorityInfo(RegisteredEditorPriority.builtin)
		},
		{
			id: 'mainThreadWebview-markdown.preview',
			label: localize('markdownPreview', "Markdown Preview"),
			priority: toRegisteredEditorPriorityInfo(RegisteredEditorPriority.builtin)
		},
		{
			id: 'mainThreadWebview-simpleBrowser.view',
			label: localize('simpleBrowser', "Simple Browser"),
			priority: toRegisteredEditorPriorityInfo(RegisteredEditorPriority.builtin)
		},
		{
			id: 'mainThreadWebview-browserPreview',
			label: localize('livePreview', "Live Preview"),
			priority: toRegisteredEditorPriorityInfo(RegisteredEditorPriority.builtin)
		}
	];

	private static readonly AUTO_LOCK_REMOVE_EDITORS = new Set<string>([


		'vscode-interactive-input',
		'interactive',
		'vscode.markdown.preview.editor'
	]);

	private readonly configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	private autoLockConfigurationNode: IConfigurationNode | undefined;
	private defaultBinaryEditorConfigurationNode: IConfigurationNode | undefined;
	private editorAssociationsConfigurationNode: IConfigurationNode | undefined;
	private diffEditorAssociationsConfigurationNode: IConfigurationNode | undefined;
	private editorLargeFileConfirmationConfigurationNode: IConfigurationNode | undefined;

	constructor(
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) {
		super();

		(async () => {
			await extensionService.whenInstalledExtensionsRegistered();

			this.updateDynamicEditorConfigurations();
			this.registerListeners();
		})();
	}

	private registerListeners(): void {

		this._register(Event.debounce(this.editorResolverService.onDidChangeEditorRegistrations, (_, e) => e)(() => this.updateDynamicEditorConfigurations()));
	}

	private updateDynamicEditorConfigurations(): void {
		const lockableEditors = [...this.editorResolverService.getEditors(), ...DynamicEditorConfigurations.AUTO_LOCK_EXTRA_EDITORS].filter(e => !DynamicEditorConfigurations.AUTO_LOCK_REMOVE_EDITORS.has(e.id));
		const binaryEditorCandidates = this.editorResolverService.getEditors().filter(e => e.priority.editor !== RegisteredEditorPriority.exclusive).map(e => e.id);

		const autoLockGroupConfiguration: IJSONSchemaMap = Object.create(null);
		for (const editor of lockableEditors) {
			autoLockGroupConfiguration[editor.id] = {
				type: 'boolean',
				default: DynamicEditorConfigurations.AUTO_LOCK_DEFAULT_ENABLED.has(editor.id),
				description: editor.label
			};
		}

		const defaultAutoLockGroupConfiguration = Object.create(null);
		for (const editor of lockableEditors) {
			defaultAutoLockGroupConfiguration[editor.id] = DynamicEditorConfigurations.AUTO_LOCK_DEFAULT_ENABLED.has(editor.id);
		}

		const oldAutoLockConfigurationNode = this.autoLockConfigurationNode;
		this.autoLockConfigurationNode = {
			...workbenchConfigurationNodeBase,
			properties: {
				'workbench.editor.autoLockGroups': {
					type: 'object',
					description: localize('workbench.editor.autoLockGroups', "If an editor matching one of the listed types is opened as the first in an editor group and more than one group is open, the group is automatically locked. Locked groups will only be used for opening editors when explicitly chosen by a user gesture (for example drag and drop), but not by default. Consequently, the active editor in a locked group is less likely to be replaced accidentally with a different editor."),
					properties: autoLockGroupConfiguration,
					default: defaultAutoLockGroupConfiguration,
					additionalProperties: false
				}
			}
		};

		const oldDefaultBinaryEditorConfigurationNode = this.defaultBinaryEditorConfigurationNode;
		this.defaultBinaryEditorConfigurationNode = {
			...workbenchConfigurationNodeBase,
			properties: {
				'workbench.editor.defaultBinaryEditor': {
					type: 'string',
					default: '',
					enum: [...binaryEditorCandidates, ''],
					description: localize('workbench.editor.defaultBinaryEditor', "The default editor for files detected as binary. If undefined, the user will be presented with a picker."),
				}
			}
		};

		const oldEditorAssociationsConfigurationNode = this.editorAssociationsConfigurationNode;
		this.editorAssociationsConfigurationNode = {
			...workbenchConfigurationNodeBase,
			properties: {
				[editorsAssociationsSettingId]: {
					type: 'object',
					markdownDescription: localize('editor.editorAssociations', "Configure [glob patterns](https://www.dardcor-code.web.id/docs/configuration/glob-patterns) to editors (for example `\"*.hex\": \"hexEditor.hexedit\"`). These have precedence over the default behavior."),
					patternProperties: {
						'.*': {
							type: 'string',
							enum: binaryEditorCandidates,
						}
					}
				}
			}
		};

		const oldDiffEditorAssociationsConfigurationNode = this.diffEditorAssociationsConfigurationNode;
		this.diffEditorAssociationsConfigurationNode = {
			...workbenchConfigurationNodeBase,
			properties: {
				[diffEditorsAssociationsSettingId]: {
					type: 'object',
					markdownDescription: localize('editor.diffEditorAssociations', "Configure [glob patterns](https://www.dardcor-code.web.id/docs/configuration/glob-patterns) to editors for diff views (for example `\"*.md\": \"vscode.markdown.preview.editor\"`). These override `workbench.editorAssociations` for diffs."),
					patternProperties: {
						'.*': {
							type: 'string',
							enum: binaryEditorCandidates,
						}
					}
				}
			}
		};

		const oldEditorLargeFileConfirmationConfigurationNode = this.editorLargeFileConfirmationConfigurationNode;
		this.editorLargeFileConfirmationConfigurationNode = {
			...workbenchConfigurationNodeBase,
			properties: {
				'workbench.editorLargeFileConfirmation': {
					type: 'number',
					default: getLargeFileConfirmationLimit(this.environmentService.remoteAuthority) / ByteSize.MB,
					minimum: 1,
					scope: ConfigurationScope.RESOURCE,
					markdownDescription: localize('editorLargeFileSizeConfirmation', "Controls the minimum size of a file in MB before asking for confirmation when opening in the editor. Note that this setting may not apply to all editor types and environments."),
				}
			}
		};

		this.configurationRegistry.updateConfigurations({
			add: [
				this.autoLockConfigurationNode,
				this.defaultBinaryEditorConfigurationNode,
				this.editorAssociationsConfigurationNode,
				this.diffEditorAssociationsConfigurationNode,
				this.editorLargeFileConfirmationConfigurationNode
			],
			remove: coalesce([
				oldAutoLockConfigurationNode,
				oldDefaultBinaryEditorConfigurationNode,
				oldEditorAssociationsConfigurationNode,
				oldDiffEditorAssociationsConfigurationNode,
				oldEditorLargeFileConfirmationConfigurationNode
			])
		});
	}
}
