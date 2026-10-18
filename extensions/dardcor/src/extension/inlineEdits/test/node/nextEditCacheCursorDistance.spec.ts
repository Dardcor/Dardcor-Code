/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { assert, beforeEach, describe, it } from 'vitest';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { InlineEditRequestLogContext } from '../../../../platform/inlineEdits/common/inlineEditLogContext';
import { MutableObservableWorkspace } from '../../../../platform/inlineEdits/common/observableWorkspace';
import type { IStatelessNextEditModelTelemetry } from '../../../../platform/inlineEdits/common/statelessNextEditProvider';
import { LogServiceImpl } from '../../../../platform/log/common/logService';
import { NullExperimentationService } from '../../../../platform/telemetry/common/nullExperimentationService';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { generateUuid } from '../../../../util/dardcor/base/common/uuid';
import { StringReplacement } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { Position } from '../../../../util/dardcor/editor/common/core/position';
import { OffsetRange } from '../../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { StringText } from '../../../../util/dardcor/editor/common/core/text/abstractText';
import { NextEditCache } from '../../node/nextEditCache';
import { NextEditFetchRequest } from '../../node/nextEditProvider';

const testModelTelemetry: IStatelessNextEditModelTelemetry = {
	modelName: undefined,
	modelConfig: undefined,
};

describe('NextEditCache cursor distance check', () => {

	let configService: InMemoryConfigurationService;
	let obsWorkspace: MutableObservableWorkspace;
	let logService: LogServiceImpl;
	let expService: NullExperimentationService;
	let cache: NextEditCache;
	let docId: DocumentId;

	const docContent = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
	const docText = new StringText(docContent);

	function makeSource(): NextEditFetchRequest {
		const logContext = new InlineEditRequestLogContext('test', 0, undefined);
		return new NextEditFetchRequest(generateUuid(), logContext, undefined, false);
	}

	function lineStartOffset(lineNumber: number): number {
		return docText.getTransformer().getOffset(new Position(lineNumber, 1));
	}

	function cursorAtLine(lineNumber: number): OffsetRange[] {
		const offset = lineStartOffset(lineNumber);
		return [new OffsetRange(offset, offset)];
	}

	beforeEach(() => {
		configService = new InMemoryConfigurationService(new DefaultsOnlyConfigurationService());
		obsWorkspace = new MutableObservableWorkspace();
		logService = new LogServiceImpl([]);
		expService = new NullExperimentationService();

		docId = DocumentId.create(URI.file('/test/cursor-distance.ts').toString());
		obsWorkspace.addDocument({ id: docId, initialValue: docContent });

		cache = new NextEditCache(obsWorkspace, logService, configService, expService);
	});

	const editStartOffset = docContent.indexOf('line6');
	const editEndOffset = editStartOffset + 'line6'.length;
	const edit = new StringReplacement(new OffsetRange(editStartOffset, editEndOffset), 'REPLACED');

	function cacheEditWithCursorAtLine(cursorLine: number) {
		cache.setKthNextEdit(
			docId,
			docText,
			undefined,
			edit,
			0,
			undefined,
			undefined,
			makeSource(),
			{ isFromCursorJump: false, modelTelemetry: testModelTelemetry, cursorOffset: lineStartOffset(cursorLine) },
		);
	}

	describe('when flag is disabled (default)', () => {
		it('serves cached edit regardless of cursor distance', () => {
			cacheEditWithCursorAtLine(5);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(1));
			assert(result?.edit, 'should serve cached edit when flag is off');
		});
	});

	describe('when flag is enabled', () => {
		beforeEach(async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsCacheCursorDistanceCheck, true);
		});

		it('serves cached edit when cursor moves closer to the edit', () => {
			cacheEditWithCursorAtLine(4);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(5));
			assert(result?.edit, 'should serve cached edit when cursor is closer');
		});

		it('serves cached edit when cursor stays at the same distance', () => {
			cacheEditWithCursorAtLine(4);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(8));
			assert(result?.edit, 'should serve cached edit at equal distance');
		});

		it('rejects cached edit when cursor moves farther from the edit', () => {
			cacheEditWithCursorAtLine(5);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(1));
			assert(result?.rejected === true, 'should return cached edit marked as rejected');
		});

		it('marks the cached edit as rejected when cursor moves farther', () => {
			cacheEditWithCursorAtLine(5);

			cache.lookupNextEdit(docId, docText, cursorAtLine(1));

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(5));
			assert(result?.rejected === true, 'cached edit should be marked as rejected');
		});

		it('does not apply to subsequent edits (subsequentN > 0)', () => {
			cache.setKthNextEdit(
				docId,
				docText,
				undefined,
				edit,
				1,
				undefined,
				undefined,
				makeSource(),
				{ isFromCursorJump: false, modelTelemetry: testModelTelemetry, cursorOffset: lineStartOffset(5) },
			);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(1));
			assert(result?.edit, 'subsequent edits should not be filtered by cursor distance');
		});

		it('does not apply when cursorOffsetAtCacheTime is not set', () => {
			cache.setKthNextEdit(
				docId,
				docText,
				undefined,
				edit,
				0,
				undefined,
				undefined,
				makeSource(),
				{ isFromCursorJump: false, modelTelemetry: testModelTelemetry },
			);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(1));
			assert(result?.edit, 'should serve when no cursor offset was recorded at cache time');
		});

		it('serves cached edit when cursor is on the same line as the edit', () => {
			cacheEditWithCursorAtLine(4);

			const result = cache.lookupNextEdit(docId, docText, cursorAtLine(6));
			assert(result?.edit, 'should serve cached edit when cursor is on the edit line');
		});
	});
});
