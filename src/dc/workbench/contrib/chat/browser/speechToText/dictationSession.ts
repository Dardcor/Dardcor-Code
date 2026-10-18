/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/dictationSession.css';
import { status } from '../../../../../base/browser/ui/aria/aria.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import { TrackedRangeStickiness } from '../../../../../editor/common/model.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IModelContentChangedEvent } from '../../../../../editor/common/textModelEvents.js';
import { localize } from '../../../../../nls.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ChatDictationSurface, ChatSpeechToTextState, IChatSpeechToTextService } from './chatSpeechToTextService.js';

const INTERIM_PROCESSING_CLASS = 'dictation-interim-processing';

const LOG_PREFIX = '[chat-stt-dictation]';
const MAX_DICTATION_DURATION_MS = 20 * 60 * 1000;

function isRecording(service: IChatSpeechToTextService): boolean {
	return service.state === ChatSpeechToTextState.Recording;
}

class LiveTranscriptInserter {
	private _anchor: Position | undefined;
	private _end: Position | undefined;
	private _needsLeadingSpace = false;
	private _processingDecorations: IEditorDecorationsCollection | undefined;
	private _finalized = false;
	private _isApplyingEdit = false;
	private _userModified = false;
	private _lastCumulativeText = '';
	private _committedText = '';
	private _revertAnchor: Position | undefined;
	private _revertEnd: Position | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _logService: ILogService,
	) { }

	update(fullText: string, interim: boolean = true): void {
		this._logService.trace(`${LOG_PREFIX} inserter.update interim=${interim} finalized=${this._finalized} userModified=${this._userModified} len=${fullText.length}`);
		if (this._finalized && interim) {
			this._logService.trace(`${LOG_PREFIX} inserter.update ignored (already finalized)`);
			return;
		}
		if (!interim) {
			this._finalized = true;
		}
		const model = this._editor.getModel();
		if (!model) {
			this._logService.trace(`${LOG_PREFIX} inserter.update no model`);
			return;
		}

		this._lastCumulativeText = fullText;
		let renderText = fullText;
		if (this._committedText) {
			const committedLength = this._committedText.length;
			renderText = fullText.slice(committedLength);
			renderText = renderText.replace(/^\s+/, '');
			if (renderText.length === 0) {
				this._logService.trace(`${LOG_PREFIX} inserter.update nothing new after user edit`);
				return;
			}
		}

		if (!this._anchor) {
			const selection = this._editor.getSelection() ?? model.getFullModelRange().collapseToEnd();
			const start = selection.getStartPosition();
			this._anchor = start;
			this._end = start;
			this._revertAnchor ??= start;
			this._needsLeadingSpace = start.column > 1 && !/\s$/.test(model.getValueInRange(new Range(
				start.lineNumber, Math.max(1, start.column - 1), start.lineNumber, start.column,
			)));
		}

		const text = (this._needsLeadingSpace ? ' ' : '') + renderText;

		const replaceRange = Range.fromPositions(this._anchor, this._end ?? this._anchor);

		const lines = text.split('\n');
		const endLine = this._anchor.lineNumber + lines.length - 1;
		const endColumn = lines.length === 1 ? this._anchor.column + lines[0].length : lines[lines.length - 1].length + 1;
		this._end = new Position(endLine, endColumn);

		const caret = this._end;
		this._isApplyingEdit = true;
		try {
			this._editor.executeEdits(
				'chatSpeechToText',
				[{ range: replaceRange, text, forceMoveMarkers: true }],
				[Selection.fromPositions(caret)],
			);
		} finally {
			this._isApplyingEdit = false;
		}

		this._updateInterimDecorations(interim);
	}

	onDidChangeModelContent(event: IModelContentChangedEvent): void {
		if (this._isApplyingEdit || !this._anchor || !this._end) {
			return;
		}
		const affectsTranscript = event.changes.some(change => Position.isBeforeOrEqual(
			new Position(change.range.startLineNumber, change.range.startColumn),
			this._end!,
		));
		if (!affectsTranscript) {
			return;
		}
		this._logService.trace(`${LOG_PREFIX} transcript invalidated by user edit`);
		this._userModified = true;
		this._committedText = this._lastCumulativeText;
		this._revertAnchor ??= this._anchor;
		this._revertEnd = this._end;
		this._anchor = undefined;
		this._end = undefined;
		this.clearInterimDecorations();
	}

	private _updateInterimDecorations(interim: boolean): void {
		if (!interim || !this._anchor || !this._end || Position.equals(this._anchor, this._end)) {
			this._logService.trace(`${LOG_PREFIX} interim decorations clear (interim=${interim})`);
			this._processingDecorations?.clear();
			return;
		}

		this._processingDecorations ??= this._editor.createDecorationsCollection();
		this._logService.trace(`${LOG_PREFIX} interim decorations ${this._anchor.lineNumber}:${this._anchor.column} -> ${this._end.lineNumber}:${this._end.column}`);
		this._processingDecorations.set([{
			range: Range.fromPositions(this._anchor, this._end),
			options: { description: 'chatSpeechToText-interim', inlineClassName: INTERIM_PROCESSING_CLASS },
		}]);
	}

	clearInterimDecorations(): void {
		this._logService.trace(`${LOG_PREFIX} clearInterimDecorations`);
		this._processingDecorations?.clear();
	}

	beginFinalize(): void {
		this._logService.trace(`${LOG_PREFIX} beginFinalize`);
		this._finalized = true;
		this._processingDecorations?.clear();
	}

	finalizedRange(): Range | undefined {
		if (this._userModified || !this._anchor || !this._end) {
			return undefined;
		}
		const start = this._needsLeadingSpace
			? new Position(this._anchor.lineNumber, this._anchor.column + 1)
			: this._anchor;
		return Range.fromPositions(start, this._end);
	}

	revert(): void {
		this._processingDecorations?.clear();
		const model = this._editor.getModel();
		const anchor = this._revertAnchor ?? this._anchor;
		const end = this._end ?? this._revertEnd;
		if (!model || !anchor || !end) {
			return;
		}
		this._editor.executeEdits('chatSpeechToText', [{
			range: Range.fromPositions(anchor, end),
			text: '',
			forceMoveMarkers: true,
		}]);
		this._editor.setPosition(anchor);
		this._anchor = undefined;
		this._end = undefined;
		this._revertAnchor = undefined;
		this._revertEnd = undefined;
	}
}

interface IActiveDictation {
	readonly service: IChatSpeechToTextService;
	readonly editor: ICodeEditor;
	readonly inserter: LiveTranscriptInserter;
	readonly disposables: DisposableStore;
	readonly logService: ILogService;
	readonly surface: ChatDictationSurface;
}

let _active: IActiveDictation | undefined;
const _onDidChangeDictationEditor = new Emitter<void>();
export const onDidChangeDictationEditor = _onDidChangeDictationEditor.event;

function setActiveDictation(active: IActiveDictation | undefined): void {
	if (_active !== active) {
		_active = active;
		_onDidChangeDictationEditor.fire();
	}
}

let _finalizing: { readonly editor: ICodeEditor; readonly promise: Promise<void> } | undefined;

function setFinalizingDictation(finalizing: typeof _finalizing): void {
	if (_finalizing !== finalizing) {
		_finalizing = finalizing;
		_onDidChangeDictationEditor.fire();
	}
}

export function isDictating(): boolean {
	return !!_active;
}

export function activeDictationEditor(): ICodeEditor | undefined {
	return _active?.editor;
}

export function isDictationActiveForEditor(editor: ICodeEditor): boolean {
	return _active?.editor === editor || _finalizing?.editor === editor;
}

export async function startDictation(service: IChatSpeechToTextService, editor: ICodeEditor, window: Window & typeof globalThis, logService: ILogService, surface: ChatDictationSurface = 'chat'): Promise<void> {
	if (_active?.editor === editor) {
		return;
	}
	if (_active || service.isBusy) {
		await service.cancel();
	}
	if (service.state !== ChatSpeechToTextState.Idle) {
		return;
	}
	const inserter = new LiveTranscriptInserter(editor, logService);
	const disposables = new DisposableStore();
	const HIDE_CURSOR_CLASS = 'dictation-hide-cursor';
	editor.getDomNode()?.classList.add(HIDE_CURSOR_CLASS);
	disposables.add(toDisposable(() => editor.getDomNode()?.classList.remove(HIDE_CURSOR_CLASS)));
	const previousPlaceholder = editor.getOption(EditorOption.placeholder);
	const listeningPlaceholder = localize('chatStt.listening', "Listening…");
	let appliedPlaceholder: string | undefined;
	const applyPlaceholder = () => {
		if (!editor.getModel()) {
			return;
		}
		const recording = service.state === ChatSpeechToTextState.Recording;
		const desired = recording && !service.isPreparingModel
			? listeningPlaceholder
			: undefined;
		if (desired !== undefined) {
			if (appliedPlaceholder !== desired) {
				editor.updateOptions({ placeholder: desired });
				appliedPlaceholder = desired;
			}
		} else if (appliedPlaceholder !== undefined) {
			editor.updateOptions({ placeholder: previousPlaceholder });
			appliedPlaceholder = undefined;
		}
	};
	disposables.add(toDisposable(() => {
		inserter.clearInterimDecorations();
		if (!editor.getModel() || appliedPlaceholder === undefined) {
			return;
		}
		editor.updateOptions({ placeholder: previousPlaceholder });
		appliedPlaceholder = undefined;
	}));
	disposables.add(service.onDidUpdateTranscript(update => {
		logService.trace(`${LOG_PREFIX} onDidUpdateTranscript len=${update.text.length} finalized=${update.finalizedText.length} state=${service.state}`);
		if (!service.showTranscriptWhileDictating) {
			inserter.clearInterimDecorations();
			return;
		}
		inserter.update(update.text);
	}));
	disposables.add(editor.onDidChangeModelContent(event => inserter.onDidChangeModelContent(event)));
	disposables.add(service.onDidChangePreparingModel(() => applyPlaceholder()));
	disposables.add(service.onDidChangeState(state => {
		logService.trace(`${LOG_PREFIX} onDidChangeState ${state}`);
		if (state === ChatSpeechToTextState.Idle && _active?.service === service) {
			setActiveDictation(undefined);
			disposables.dispose();
			return;
		}
		applyPlaceholder();
	}));
	disposables.add(editor.onDidDispose(() => cancelDictation()));
	const activeDictation = { service, editor, inserter, disposables, logService, surface };
	setActiveDictation(activeDictation);
	try {
		await service.start(window, surface);
		if (_active === activeDictation && isRecording(service)) {
			const durationLimit = window.setTimeout(() => {
				logService.info(`${LOG_PREFIX} stopping after maximum duration`);
				status(localize('chatStt.maximumDurationReached', "Dictation stopped after 20 minutes."));
				void stopDictation();
			}, MAX_DICTATION_DURATION_MS);
			disposables.add(toDisposable(() => window.clearTimeout(durationLimit)));
		}
	} catch {
		if (_active === activeDictation) {
			setActiveDictation(undefined);
		}
		disposables.dispose();
	}
}

export async function stopDictation(): Promise<void> {
	const active = _active;
	if (!active) {
		await _finalizing?.promise;
		return;
	}
	setActiveDictation(undefined);
	const promise = finalizeDictation(active);
	setFinalizingDictation({ editor: active.editor, promise });
	try {
		await promise;
	} finally {
		if (_finalizing?.promise === promise) {
			setFinalizingDictation(undefined);
		}
	}
}

async function finalizeDictation(active: IActiveDictation): Promise<void> {
	active.logService.trace(`${LOG_PREFIX} stopDictation begin, state=${active.service.state}`);
	active.inserter.beginFinalize();
	try {
		const text = await active.service.stopAndTranscribe();
		active.logService.trace(`${LOG_PREFIX} stopAndTranscribe resolved text=${text === undefined ? 'undefined' : `len=${text.length}`}`);
		if (text !== undefined) {
			active.inserter.update(text, false);
			trackDictationAccuracy(active, text);
		} else {
			active.inserter.clearInterimDecorations();
		}
	} finally {
		active.logService.trace(`${LOG_PREFIX} stopDictation dispose`);
		active.disposables.dispose();
		active.editor.focus();
	}
}

export async function stopDictationForEditor(editor: ICodeEditor): Promise<void> {
	if (_active?.editor === editor) {
		await stopDictation();
	} else if (_finalizing?.editor === editor) {
		await _finalizing.promise;
	}
}

export function cancelDictation(): void {
	const active = _active;
	if (!active) {
		return;
	}
	setActiveDictation(undefined);
	active.inserter.revert();
	active.disposables.dispose();
	void active.service.cancel();
}

interface IDictationAccuracyTracker {
	readonly editor: ICodeEditor;
	measure(submitted: boolean): void;
}

const _accuracyTrackers = new Set<IDictationAccuracyTracker>();

export function notifyDictationSubmitted(editor: ICodeEditor): void {
	for (const tracker of [..._accuracyTrackers]) {
		if (tracker.editor === editor) {
			tracker.measure(true);
		}
	}
}

function trackDictationAccuracy(active: IActiveDictation, dictatedText: string): void {
	const { editor, inserter, service, surface } = active;
	const model = editor.getModel();
	const range = inserter.finalizedRange();
	if (!model || !range || !dictatedText) {
		return;
	}
	const backend = service.currentBackend;
	const collection = editor.createDecorationsCollection([{
		range,
		options: {
			description: 'chatSpeechToText-accuracy',
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		},
	}]);
	const store = new DisposableStore();
	let measured = false;
	const tracker: IDictationAccuracyTracker = {
		editor,
		measure(submitted: boolean) {
			if (measured) {
				return;
			}
			measured = true;
			const current = collection.getRange(0);
			const submittedText = current ? model.getValueInRange(current) : '';
			service.logDictationAccuracy({ dictatedText, submittedText, backend, surface, submitted });
			collection.clear();
			store.dispose();
			_accuracyTrackers.delete(tracker);
		},
	};
	store.add(model.onDidChangeContent(() => {
		if (model.getValueLength() === 0) {
			tracker.measure(false);
		}
	}));
	store.add(model.onWillDispose(() => tracker.measure(false)));
	store.add(editor.onDidDispose(() => tracker.measure(false)));
	_accuracyTrackers.add(tracker);
}
