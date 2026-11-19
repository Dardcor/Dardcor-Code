/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clipboard } from 'electron';
import type * as monaco from 'monaco-editor';
import * as React from 'react';
import { monacoModule } from '../utils/utils';
import { DraggableBottomBorder } from './draggableBottomBorder';

const TAG_REGEX = /<\|\/?([^|\n]+)\|>/g;

const tagIndexByName = new Map<string, number>();
const injectedTagIndices = new Set<number>();
let tagStyleElement: HTMLStyleElement | undefined;

const GOLDEN_ANGLE_DEGREES = 137.50776;

function tagDecorationClassName(tagName: string): string {
	let index = tagIndexByName.get(tagName);
	if (index === undefined) {
		index = tagIndexByName.size;
		tagIndexByName.set(tagName, index);
	}
	const className = `adhoc-tag-hl-${index}`;
	if (!injectedTagIndices.has(index)) {
		injectedTagIndices.add(index);
		if (!tagStyleElement) {
			tagStyleElement = document.createElement('style');
			document.head.appendChild(tagStyleElement);
		}
		const hue = Math.round((index * GOLDEN_ANGLE_DEGREES) % 360);
		tagStyleElement.appendChild(document.createTextNode(
			`.${className} { background-color: hsla(${hue}, 70%, 55%, 0.3); border-radius: 3px; }`
		));
	}
	return className;
}

type Props = {
	value: string;
	languageId?: string;
	readOnly?: boolean;
	initialHeight?: number;
	autoFocus?: boolean;
	onChange?: (value: string) => void;
};

export const AdhocRequestEditor = (({ value, languageId, readOnly, initialHeight, autoFocus, onChange }: Props) => {
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const [editor, setEditor] = React.useState<monaco.editor.IStandaloneCodeEditor | null>(null);
	const [height, setHeight] = React.useState<number>(initialHeight ?? 160);
	const [isFocused, setIsFocused] = React.useState(false);

	const onChangeRef = React.useRef(onChange);
	onChangeRef.current = onChange;

	const isApplyingExternalValueRef = React.useRef(false);

	const monaco = monacoModule.value;

	React.useEffect(() => {
		if (!containerRef.current) {
			return;
		}
		const myEditor = monaco.editor.create(containerRef.current, {
			automaticLayout: true,
			model: monaco.editor.createModel(value, languageId ?? 'plaintext'),
			minimap: { enabled: false },
			readOnly: readOnly ?? false,
			scrollBeyondLastLine: false,
			wordWrap: 'on',
			lineNumbers: 'off',
			folding: false,
			overviewRulerLanes: 0,
			padding: { top: 6, bottom: 6 },
		});
		setEditor(myEditor);

		const container = containerRef.current;
		const handlePasteShortcut = (e: KeyboardEvent) => {
			const isPasteShortcut = (e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V');
			if (!isPasteShortcut) {
				return;
			}
			if (myEditor.getOption(monaco.editor.EditorOption.readOnly)) {
				return;
			}
			const selections = myEditor.getSelections();
			if (!selections || selections.length === 0) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const text = clipboard.readText();
			if (!text) {
				return;
			}
			myEditor.pushUndoStop();
			myEditor.executeEdits('electron-clipboard-paste', selections.map(selection => ({ range: selection, text, forceMoveMarkers: true })));
			myEditor.pushUndoStop();
		};
		container.addEventListener('keydown', handlePasteShortcut, true);

		const focusListener = myEditor.onDidFocusEditorText(() => setIsFocused(true));
		const blurListener = myEditor.onDidBlurEditorText(() => setIsFocused(false));

		const tagDecorations = myEditor.createDecorationsCollection();
		const updateTagDecorations = () => {
			const model = myEditor.getModel();
			if (!model) {
				return;
			}
			const text = model.getValue();
			const decorations: monaco.editor.IModelDeltaDecoration[] = [];
			TAG_REGEX.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = TAG_REGEX.exec(text)) !== null) {
				const start = model.getPositionAt(match.index);
				const end = model.getPositionAt(match.index + match[0].length);
				decorations.push({
					range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
					options: { inlineClassName: tagDecorationClassName(match[1]) },
				});
			}
			tagDecorations.set(decorations);
		};
		let pendingTagDecorationsFrame: number | undefined;
		const scheduleTagDecorationsUpdate = () => {
			if (pendingTagDecorationsFrame !== undefined) {
				return;
			}
			pendingTagDecorationsFrame = requestAnimationFrame(() => {
				pendingTagDecorationsFrame = undefined;
				updateTagDecorations();
			});
		};
		updateTagDecorations();

		const listener = myEditor.onDidChangeModelContent(() => {
			scheduleTagDecorationsUpdate();
			if (isApplyingExternalValueRef.current) {
				return;
			}
			onChangeRef.current?.(myEditor.getValue());
		});

		if (autoFocus) {
			myEditor.focus();
		}

		return () => {
			if (pendingTagDecorationsFrame !== undefined) {
				cancelAnimationFrame(pendingTagDecorationsFrame);
			}
			container.removeEventListener('keydown', handlePasteShortcut, true);
			focusListener.dispose();
			blurListener.dispose();
			listener.dispose();
			const model = myEditor.getModel();
			if (model) {
				model.dispose();
			}
			myEditor.dispose();
		};
	}, []);

	React.useEffect(() => {
		if (!editor) {
			return;
		}
		const model = editor.getModel();
		if (!model) {
			return;
		}
		if (languageId && model.getLanguageId() !== languageId) {
			monaco.editor.setModelLanguage(model, languageId);
		}
		if (model.getValue() !== value) {
			isApplyingExternalValueRef.current = true;
			try {
				if (readOnly) {
					model.setValue(value);
					editor.revealLine(model.getLineCount(), monaco.editor.ScrollType.Immediate);
				} else {
					editor.executeEdits('external', [{ range: model.getFullModelRange(), text: value }]);
				}
			} finally {
				isApplyingExternalValueRef.current = false;
			}
		}
	}, [editor, value, languageId, readOnly]);

	return (
		<div>
			<div
				className='file-editor-container adhoc-request-editor'
				style={{
					height: `${height}px`,
					position: 'relative',
					boxShadow: isFocused ? '0 0 0 2px #0078d4, 0 0 6px 2px rgba(0, 120, 212, 0.45)' : undefined,
					transition: 'box-shadow 0.1s ease-in-out',
				}}
				ref={containerRef}
			/>
			<DraggableBottomBorder height={height} setHeight={setHeight} />
		</div>
	);
});
