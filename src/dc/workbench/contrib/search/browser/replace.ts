/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProgress, IProgressStep } from '../../../../platform/progress/common/progress.js';
import { ISearchTreeFileMatch, ISearchTreeMatch, FileMatchOrMatch } from './searchTreeModel/searchTreeCommon.js';

export const IReplaceService = createDecorator<IReplaceService>('replaceService');

export interface IReplaceService {

	readonly _serviceBrand: undefined;

	replace(match: ISearchTreeMatch): Promise<any>;

	replace(files: ISearchTreeFileMatch[], progress?: IProgress<IProgressStep>): Promise<any>;

	openReplacePreview(element: FileMatchOrMatch, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean): Promise<any>;

	updateReplacePreview(file: ISearchTreeFileMatch, override?: boolean): Promise<void>;
}
