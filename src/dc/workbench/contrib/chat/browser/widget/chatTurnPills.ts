/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from '../../../../../base/common/actions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { derived, IObservable, IReader } from '../../../../../base/common/observable.js';
import { isWeb } from '../../../../../base/common/platform.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { DEFAULT_LABELS_CONTAINER, ResourceLabels } from '../../../../browser/labels.js';
import { BrowserViewEditorId } from '../../../browserView/common/browserView.js';
import { getEditorOverrideForChatResource } from './chatEditorAssociations.js';
import { ChatPillsWidget, getChatPillEntries, IChatPill, type IChatPillSection } from '../../../../browser/chatPills.js';
import { ChatChangesPillActionViewItem } from '../../../../browser/chatChangesPill.js';
import { ChatPillSingleEntry, createChatSectionPill, type IChatDropdownPillOptions } from '../../../../browser/chatDropdownPill.js';

export type ChatTurnStatusPillsSetting = boolean | { changes?: boolean; preview?: boolean; artifacts?: boolean };

export const chatArtifactPillOptions: IChatDropdownPillOptions = {
	widgetId: 'chatArtifacts',
	icon: Codicon.package,
	title: localize('chatArtifacts.title', "Artifacts"),
	summaryLabel: count => count === 1
		? localize('chatArtifacts.countSingle', "1 Artifact")
		: localize('chatArtifacts.count', "{0} Artifacts", count),
	summaryAriaLabel: count => count === 1
		? localize('chatArtifacts.showSingle', "Show 1 artifact")
		: localize('chatArtifacts.show', "Show {0} artifacts", count),
	singleEntry: ChatPillSingleEntry.InlineResource,
};

export const CHAT_TURN_CHANGES_PILL_ID = 'chat.turnPills.changes';
export const CHAT_TURN_ARTIFACT_PILL_ID = 'chat.turnPills.artifact';

export interface IDiffStats {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export const EMPTY_DIFF_STATS: IDiffStats = { files: 0, insertions: 0, deletions: 0 };

export interface IPreviewFile {
	readonly uri: URI;
	readonly kind: 'markdown' | 'html';
	readonly created: boolean;
}

export function previewKind(uri: URI, htmlPreviewAvailable = !isWeb): IPreviewFile['kind'] | undefined {
	const path = uri.path.toLowerCase();
	if (path.endsWith('.md') || path.endsWith('.markdown')) {
		return 'markdown';
	}
	if (htmlPreviewAvailable && uri.scheme === Schemas.file && (path.endsWith('.html') || path.endsWith('.htm'))) {
		return 'html';
	}
	return undefined;
}

export function diffStatsEqual(a: IDiffStats, b: IDiffStats): boolean {
	return a.files === b.files && a.insertions === b.insertions && a.deletions === b.deletions;
}

export function previewFilesEqual(a: readonly IPreviewFile[], b: readonly IPreviewFile[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i].kind !== b[i].kind || a[i].created !== b[i].created || !isEqual(a[i].uri, b[i].uri)) {
			return false;
		}
	}
	return true;
}

export async function openChatTurnFile(file: IPreviewFile, openerService: IOpenerService, configurationService: IConfigurationService): Promise<void> {
	const configuredOverride = getEditorOverrideForChatResource(file.uri, configurationService);
	await openerService.open(file.uri, {
		fromUserGesture: true,
		editorOptions: {
			override: configuredOverride ?? (file.kind === 'html' ? BrowserViewEditorId : undefined),
		},
	});
}

export interface IChatTurnPillsModel {
	readonly stats: IObservable<IDiffStats>;
	readonly artifacts: IObservable<readonly IChatPillSection[]>;
	readonly changesEnabled: IObservable<boolean>;
	readonly artifactsEnabled: IObservable<boolean>;
	openChanges(): void;
}

export class ChatTurnPillsProvider extends Disposable {

	readonly pills: IObservable<readonly IChatPill[]>;

	private readonly _changesAction: Action;
	private readonly _artifactAction: Action;
	private readonly _resourceLabels: ResourceLabels;

	constructor(
		private readonly _model: IChatTurnPillsModel,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._resourceLabels = this._register(this._instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));

		this._changesAction = this._register(new Action(CHAT_TURN_CHANGES_PILL_ID, localize('chatTurnPills.changes.tooltip', "View Current Turn Changes"), undefined, true, async () => this._model.openChanges()));
		this._artifactAction = this._register(new Action(CHAT_TURN_ARTIFACT_PILL_ID, localize('chatTurnPills.artifact.label', "Open Artifact"), undefined, true, async () => this._openPrimaryArtifact()));

		const changesPill: IChatPill = {
			action: this._changesAction,
			createActionViewItem: options => new ChatChangesPillActionViewItem(this._changesAction, options, this._model.stats, this._instantiationService),
		};
		const artifactPill = createChatSectionPill(this._artifactAction, this._model.artifacts, chatArtifactPillOptions, this._resourceLabels, this._instantiationService);
		this.pills = derived(this, reader => {
			const pills: IChatPill[] = [];
			if (this._showChanges(reader)) {
				pills.push(changesPill);
			}
			if (this._showArtifacts(reader)) {
				pills.push(artifactPill.read(reader));
			}
			return pills;
		});
	}

	private _showChanges(reader: IReader): boolean {
		return this._model.changesEnabled.read(reader) && this._model.stats.read(reader).files > 0;
	}

	private _showArtifacts(reader: IReader): boolean {
		return this._model.artifactsEnabled.read(reader) && getChatPillEntries(this._model.artifacts.read(reader)).length > 0;
	}

	private _openPrimaryArtifact(): void {
		getChatPillEntries(this._model.artifacts.get()).at(0)?.open();
	}

}

export class ChatTurnPillsWidget extends Disposable {

	readonly element: HTMLElement;
	readonly isVisible: IObservable<boolean>;

	constructor(
		model: IChatTurnPillsModel,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const provider = this._register(instantiationService.createInstance(ChatTurnPillsProvider, model));
		const widget = this._register(instantiationService.createInstance(ChatPillsWidget, { pills: provider.pills }, {
			ariaLabel: localize('chatTurnPills.ariaLabel', "Turn status"),
		}));
		widget.element.classList.add('chat-turn-pills', 'show-file-icons');
		this.element = widget.element;
		this.isVisible = widget.isVisible;
	}
}
