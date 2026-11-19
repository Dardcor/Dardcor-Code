/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert, assertNever } from '../../../../util/dardcor/base/common/assert';
import { Disposable } from '../../../../util/dardcor/base/common/lifecycle';
import { LinkedList } from '../../../../util/dardcor/base/common/linkedList';
import { mapObservableArrayCached } from '../../../../util/dardcor/base/common/observable';
import { derived, IObservable } from '../../../../util/dardcor/base/common/observableInternal';
import { LineEdit } from '../../../../util/dardcor/editor/common/core/edits/lineEdit';
import { StringEdit } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { StringText } from '../../../../util/dardcor/editor/common/core/text/abstractText';
import { ConfigKey, IConfigurationService } from '../../../configuration/common/configurationService';
import { IExperimentationService } from '../../../telemetry/common/nullExperimentationService';
import { DocumentId } from '../dataTypes/documentId';
import { RootedEdit } from '../dataTypes/edit';
import { DiffHistoryMergeStrategy } from '../dataTypes/xtabHistoryOptions';
import { IObservableDocument, ObservableWorkspace } from '../observableWorkspace';
import { autorunWithChanges } from '../utils/observable';
import { Instant, now } from '../utils/utils';

export interface IXtabHistoryDocumentEntry {
	docId: DocumentId;
}

export interface IXtabHistoryEditEntry extends IXtabHistoryDocumentEntry {
	kind: 'edit';
	edit: RootedEdit;
}

export interface IXtabHistoryVisibleRangesEntry extends IXtabHistoryDocumentEntry {
	kind: 'visibleRanges';
	visibleRanges: readonly OffsetRange[];
	documentContent: StringText;
}

export type IXtabHistoryEntry =
	| IXtabHistoryEditEntry
	| IXtabHistoryVisibleRangesEntry;

type DocumentChangedEvent = {
	value: StringText;
	changes: StringEdit[];
	previous: StringText | undefined;
};

type DocumentSelectionChangedEvent = {
	value: readonly OffsetRange[];
	changes: unknown[];
	previous: readonly OffsetRange[] | undefined;
};

export type XtabEditMergeStrategy =
	| { readonly kind: DiffHistoryMergeStrategy.SameStartLine }
	| { readonly kind: DiffHistoryMergeStrategy.Proximity; readonly lineGap: number }
	| { readonly kind: DiffHistoryMergeStrategy.Hybrid; readonly lineGap: number; readonly splitAfterMs: number };

export namespace XtabEditMergeStrategy {
	export const sameStartLine: XtabEditMergeStrategy = { kind: DiffHistoryMergeStrategy.SameStartLine };

	export function proximity(lineGap: number): XtabEditMergeStrategy {
		return { kind: DiffHistoryMergeStrategy.Proximity, lineGap };
	}

	export function hybrid(lineGap: number, splitAfterMs: number): XtabEditMergeStrategy {
		return { kind: DiffHistoryMergeStrategy.Hybrid, lineGap, splitAfterMs };
	}

	export function fromConfig(strategyKind: DiffHistoryMergeStrategy, lineGap: number, splitAfterMs: number): XtabEditMergeStrategy {
		switch (strategyKind) {
			case DiffHistoryMergeStrategy.Proximity:
				return proximity(lineGap);
			case DiffHistoryMergeStrategy.Hybrid:
				return hybrid(lineGap, splitAfterMs);
			case DiffHistoryMergeStrategy.SameStartLine:
				return sameStartLine;
			default:
				assertNever(strategyKind);
		}
	}
}

function areLineEditsWithinProximity(a: LineEdit, b: LineEdit, maxLineGap: number): boolean {
	if (a.isEmpty() || b.isEmpty()) {
		return false;
	}
	for (const repA of a.replacements) {
		const closeToSomeInB = b.replacements.some(repB => repA.lineRange.distanceToRange(repB.lineRange) <= maxLineGap);
		if (!closeToSomeInB) {
			return false;
		}
	}
	return true;
}

export class NesXtabHistoryTracker extends Disposable {

	private static MAX_HISTORY_SIZE = 50;

	private readonly idToEntry: Map<DocumentId, { entry: IXtabHistoryEntry; removeFromHistory: () => void; lastEditTimestamp: Instant }>;
	private readonly history: LinkedList<IXtabHistoryEntry>;

	private readonly maxHistorySize: number;

	protected mergeStrategy: IObservable<XtabEditMergeStrategy>;

	constructor(
		workspace: ObservableWorkspace,
		maxHistorySize: number | undefined,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExperimentationService private readonly _expService: IExperimentationService,
	) {
		super();

		this.idToEntry = new Map();
		this.history = new LinkedList();

		this.maxHistorySize = maxHistorySize ?? NesXtabHistoryTracker.MAX_HISTORY_SIZE;

		this.mergeStrategy = derived(reader => XtabEditMergeStrategy.fromConfig(
			this._configurationService.getExperimentBasedConfigObservable(ConfigKey.TeamInternal.InlineEditsXtabDiffMergeStrategy, this._expService).read(reader),
			this._configurationService.getExperimentBasedConfigObservable(ConfigKey.TeamInternal.InlineEditsXtabDiffMergeLineGap, this._expService).read(reader),
			this._configurationService.getExperimentBasedConfigObservable(ConfigKey.TeamInternal.InlineEditsXtabDiffMergeSplitAfterMs, this._expService).read(reader),
		));

		mapObservableArrayCached(this, workspace.openDocuments, (doc, store) => {

			store.add(autorunWithChanges(this, {
				rootedEdits: doc.value,
				visibleRanges: doc.visibleRanges,
			}, (data) => {

				if (data.rootedEdits.changes.length > 0 && data.rootedEdits.previous !== undefined) {
					this.handleEdits(doc, data.rootedEdits);
				} else {
					this.handleVisibleRangesChange(doc, data.visibleRanges);
				}
			}));

		}, d => d.id).recomputeInitiallyAndOnChange(this._store);
	}

	getHistory(): IXtabHistoryEntry[] {
		return [...this.history];
	}

	private handleVisibleRangesChange(doc: IObservableDocument, visibleRangesChange: DocumentSelectionChangedEvent) {
		if (visibleRangesChange.value.length === 0) {
			return;
		}

		const previousRecord = this.idToEntry.get(doc.id);

		if (previousRecord !== undefined) {
			if (previousRecord.entry.kind === 'edit') {
				return;
			}
			previousRecord.removeFromHistory();
		}

		const entry: IXtabHistoryEntry = { docId: doc.id, kind: 'visibleRanges', visibleRanges: visibleRangesChange.value, documentContent: doc.value.get() };
		const removeFromHistory = this.history.push(entry);
		this.idToEntry.set(doc.id, { entry, removeFromHistory, lastEditTimestamp: now() });

		this.compactHistory();
	}

	private shouldMerge(lastLineEdit: LineEdit, currentLineEdit: LineEdit, lastEditTimestamp: Instant): boolean {
		const strategy = this.mergeStrategy.get();
		switch (strategy.kind) {
			case DiffHistoryMergeStrategy.SameStartLine:
				return !currentLineEdit.isEmpty()
					&& !lastLineEdit.isEmpty()
					&& lastLineEdit.replacements[0].lineRange.startLineNumber === currentLineEdit.replacements[0].lineRange.startLineNumber;

			case DiffHistoryMergeStrategy.Proximity:
				return areLineEditsWithinProximity(currentLineEdit, lastLineEdit, strategy.lineGap);

			case DiffHistoryMergeStrategy.Hybrid: {
				const withinTimeWindow = (now() - lastEditTimestamp) <= strategy.splitAfterMs;
				return withinTimeWindow && areLineEditsWithinProximity(currentLineEdit, lastLineEdit, strategy.lineGap);
			}
		}
	}

	private handleEdits(doc: IObservableDocument, rootedEdits: DocumentChangedEvent) {
		assert(rootedEdits.previous !== undefined, `Document has previous version`);
		assert(rootedEdits.changes.length === 1, `Expected 1 edit change but got ${rootedEdits.changes.length}`);

		const currentEdit = rootedEdits.changes[0];
		if (currentEdit.replacements.length === 0) {
			return;
		}

		const previousRecord = this.idToEntry.get(doc.id);

		const currentBase = rootedEdits.previous;
		const currentRootedEdit = new RootedEdit(currentBase, currentEdit);

		if (previousRecord === undefined) {
			this.pushToHistory(doc.id, currentRootedEdit);
			return;
		}

		if (previousRecord.entry.kind === 'visibleRanges') {
			previousRecord.removeFromHistory();
			this.pushToHistory(doc.id, currentRootedEdit);
			return;
		}

		const lastRootedEdit = previousRecord.entry.edit;
		const lastLineEdit = RootedEdit.toLineEdit(lastRootedEdit);
		const currentLineEdit = RootedEdit.toLineEdit(currentRootedEdit);

		if (this.shouldMerge(lastLineEdit, currentLineEdit, previousRecord.lastEditTimestamp)) {
			previousRecord.removeFromHistory();
			const composedEdit = lastRootedEdit.edit.compose(currentEdit);
			const edit = new RootedEdit(lastRootedEdit.base, composedEdit);
			this.pushToHistory(doc.id, edit);

		} else {
			this.pushToHistory(doc.id, currentRootedEdit);
		}
	}

	private pushToHistory(docId: DocumentId, edit: RootedEdit) {
		const entry: IXtabHistoryEntry = { docId, kind: 'edit', edit };
		const removeFromHistory = this.history.push(entry);
		this.idToEntry.set(docId, { entry, removeFromHistory, lastEditTimestamp: now() });

		this.compactHistory();
	}

	private compactHistory() {
		if (this.history.size > this.maxHistorySize) {
			const removedEntry = this.history.shift();
			if (removedEntry !== undefined) {
				const lastRecord = this.idToEntry.get(removedEntry.docId);
				if (lastRecord !== undefined && removedEntry === lastRecord.entry) {
					this.idToEntry.delete(removedEntry.docId);
				}
			}
		}
	}
}
