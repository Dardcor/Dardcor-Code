/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservableDocument } from '../../../../../../../platform/inlineEdits/common/observableWorkspace';
import { autorunWithChanges } from '../../../../../../../platform/inlineEdits/common/utils/observable';
import { createServiceIdentifier } from '../../../../../../../util/common/services';
import { Disposable } from '../../../../../../../util/dardcor/base/common/lifecycle';
import { mapObservableArrayCached } from '../../../../../../../util/dardcor/base/common/observableInternal';
import { ICompletionsObservableWorkspace } from '../../completionsObservableWorkspace';
import {
	getAllRecentEditsByTimestamp,
	RecentEdit,
	RecentEditMap,
	recentEditsReducer,
	summarizeEdit,
} from './recentEditsReducer';

export const ICompletionsRecentEditsProviderService = createServiceIdentifier<ICompletionsRecentEditsProviderService>('ICompletionsRecentEditsProviderService');
export interface ICompletionsRecentEditsProviderService {
	readonly _serviceBrand: undefined;
	isEnabled(): boolean;
	getRecentEdits(): RecentEdit[];
	getEditSummary(edit: RecentEdit): string | null;
	start(): void;
}

export interface RecentEditsConfig {
	maxFiles: number;
	maxEdits: number;
	diffContextLines: number;
	editMergeLineDistance: number;
	maxCharsPerEdit: number;
	debounceTimeout: number;
	summarizationFormat: string;
	removeDeletedLines: boolean;
	insertionsBeforeDeletions: boolean;
	appendNoReplyMarker: boolean;
	activeDocDistanceLimitFromCursor: number | undefined;
	maxLinesPerEdit: number;
}

const RECENT_EDITS_DEFAULT_CONFIG: RecentEditsConfig = Object.freeze({
	maxFiles: 20,
	maxEdits: 8,
	diffContextLines: 3,
	editMergeLineDistance: 1,
	maxCharsPerEdit: 2000,
	debounceTimeout: 500,
	summarizationFormat: 'diff',
	removeDeletedLines: false,
	insertionsBeforeDeletions: true,
	appendNoReplyMarker: true,
	activeDocDistanceLimitFromCursor: 100,
	maxLinesPerEdit: 10,
});

export class FullRecentEditsProvider extends Disposable implements ICompletionsRecentEditsProviderService {
	declare _serviceBrand: undefined;

	private _started: boolean = false;
	private recentEditMap: RecentEditMap = {};
	private recentEdits: RecentEdit[] = [];
	private recentEditSummaries: WeakMap<RecentEdit, string | null> = new WeakMap();
	private debounceTimeouts: { [key: string]: TimeoutHandle } = {};
	private readonly _config: RecentEditsConfig;

	constructor(
		config: RecentEditsConfig | undefined,
		@ICompletionsObservableWorkspace private readonly observableWorkspace: ICompletionsObservableWorkspace,
	) {
		super();
		this._config = config ?? Object.assign({}, RECENT_EDITS_DEFAULT_CONFIG);
	}

	get config(): RecentEditsConfig {
		return this._config;
	}

	isEnabled(): boolean {
		return true;
	}

	getRecentEdits(): RecentEdit[] {
		return this.recentEdits;
	}

	getEditSummary(edit: RecentEdit): string | null {
		return this.recentEditSummaries.get(edit) ?? null;
	}

	protected updateRecentEdits(docId: string, newContents: string): void {
		this.recentEditMap = recentEditsReducer(this.recentEditMap, docId, newContents, this._config);
		this.recentEdits = getAllRecentEditsByTimestamp(this.recentEditMap);

		this.recentEdits.forEach(edit => {
			if (!this.recentEditSummaries.has(edit)) {
				const summary = summarizeEdit(edit, this._config);
				this.recentEditSummaries.set(edit, summary);
			}
		});
	}

	start() {
		if (this._started) {
			return;
		}
		this._started = true;

		mapObservableArrayCached(
			this,
			this.observableWorkspace.openDocuments,
			(doc: IObservableDocument, store) => {
				store.add(
					autorunWithChanges(
						this,
						{
							value: doc.value,
							selection: doc.selection,
							languageId: doc.languageId,
						},
						data => {
							if (data.value.changes.length > 0) {
								const prevText = data.value.previous?.value;
								const newText = data.value.value.value;
								const docId = doc.id.toString();

								clearTimeout(this.debounceTimeouts[docId]);

								if (!this.recentEditMap[docId] && prevText) {
									this.updateRecentEdits(docId, prevText);
								} else if (this._config.debounceTimeout === 0) {
									this.updateRecentEdits(docId, newText);
								} else {
									this.debounceTimeouts[docId] = setTimeout(() => {
										this.updateRecentEdits(docId, newText);
									}, this._config.debounceTimeout ?? 500);
								}
							}
						}
					)
				);
			},
			d => d.id
		).recomputeInitiallyAndOnChange(this._store);
	}
}
