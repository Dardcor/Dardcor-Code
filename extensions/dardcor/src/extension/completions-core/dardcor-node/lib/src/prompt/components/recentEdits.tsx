/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/** @jsxRuntime automatic */
/** @jsxImportSource ../../../../prompt/jsx-runtime */

import { Chunk, ComponentContext, PromptElementProps, Text } from '../../../../prompt/src/components/components';
import { newLineEnded } from '../../../../prompt/src/languageMarker';
import { ICompletionsTextDocumentManagerService } from '../../textDocumentManager';
import {
	CompletionRequestData,
	isCompletionRequestData,
} from '../completionsPromptFactory/componentsCompletionsPromptFactory';
import { FullRecentEditsProvider, ICompletionsRecentEditsProviderService } from '../recentEdits/recentEditsProvider';
import { RecentEdit } from '../recentEdits/recentEditsReducer';

export function editIsTooCloseToCursor(
	edit: RecentEdit,
	filterByCursorLine: boolean = false,
	cursorLine: number | undefined = undefined,
	activeDocDistanceLimitFromCursor: number | undefined
): boolean {
	if (filterByCursorLine) {
		if (cursorLine === undefined || activeDocDistanceLimitFromCursor === undefined) {
			throw new Error(
				'cursorLine and activeDocDistanceLimitFromCursor are required when filterByCursorLine is true'
			);
		}
	}

	const startLineNumber = edit.startLine - 1;
	const endLineNumber = edit.endLine - 1;

	if (
		filterByCursorLine &&
		(Math.abs(startLineNumber - cursorLine!) <= activeDocDistanceLimitFromCursor! ||
			Math.abs(endLineNumber - cursorLine!) <= activeDocDistanceLimitFromCursor!)
	) {
		return true;
	}
	return false;
}

type RecentEditsProps = {
	tdms: ICompletionsTextDocumentManagerService;
	recentEditsProvider: ICompletionsRecentEditsProviderService;
} & PromptElementProps;

export const RecentEdits = (props: RecentEditsProps, context: ComponentContext) => {
	const [prompt, setPrompt] = context.useState<string | undefined>();

	context.useData(isCompletionRequestData, async (request: CompletionRequestData) => {
		if (!request.document) { return; }

		const recentEditProvider = props.recentEditsProvider;

		if (recentEditProvider.isEnabled()) {
			recentEditProvider.start();
		} else {
			return;
		}

		const recentEditsConfig = (recentEditProvider as FullRecentEditsProvider).config;
		const recentEdits = recentEditProvider.getRecentEdits();

		const filesIncluded = new Set<string>();
		const tdm = props.tdms;
		const editSummaries: string[] = [];

		for (let i = recentEdits.length - 1; i >= 0; i--) {
			if (editSummaries.length >= recentEditsConfig.maxEdits) { break; }

			const edit = recentEdits[i];

			if (!(await tdm.getTextDocument({ uri: edit.file }))) { continue; }

			const isNewFile = !filesIncluded.has(edit.file);
			const projectedFileCount = filesIncluded.size + (isNewFile ? 1 : 0);
			if (projectedFileCount > recentEditsConfig.maxFiles) { break; }

			const filterByCursorLine = edit.file === request.document?.uri;
			const activeDocCursorLine = filterByCursorLine ? request.position.line : undefined;

			const editTooClose = editIsTooCloseToCursor(
				edit,
				filterByCursorLine,
				activeDocCursorLine,
				recentEditsConfig.activeDocDistanceLimitFromCursor
			);
			if (editTooClose) {
				continue;
			}

			const summarizedEdit = recentEditProvider.getEditSummary(edit);
			if (summarizedEdit) {
				filesIncluded.add(edit.file);
				const relativePathOrUri = tdm.getRelativePath({ uri: edit.file });
				editSummaries.unshift(newLineEnded(`File: ${relativePathOrUri}`) + newLineEnded(summarizedEdit));
			}
		}

		if (editSummaries.length === 0) {
			setPrompt(undefined);
			return;
		}

		const newPrompt =
			newLineEnded('These are recently edited files. Do not suggest code that has been deleted.') +
			editSummaries.join('') +
			newLineEnded('End of recent edits');

		setPrompt(newPrompt);
	});

	return prompt ? (
		<Chunk>
			<Text>{prompt}</Text>
		</Chunk>
	) : undefined;
};
