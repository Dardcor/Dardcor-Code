/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, Range } from 'vscode';
import { DardcorNamedAnnotationList } from '../../../../../../platform/completions-core/common/openai/dardcorAnnotations';

export interface BasePanelCompletion {
	insertText: string;
	range: Range;
	dardcorAnnotations?: DardcorNamedAnnotationList;
	postInsertionCallback: () => PromiseLike<void> | void;
}

export interface ISuggestionsPanel {
	cancellationToken: CancellationToken;
	onWorkDone(_: { percentage: number }): void;
	onItem(_: BasePanelCompletion): void;
	onFinished(): void;
}

export interface PanelConfig {
	panelTitle: string;
	webviewId: string;
	webviewScriptName: string;
	contextVariable: string;
	commands: {
		accept: string;
		navigatePrevious: string;
		navigateNext: string;
	};
	renderingMode: 'streaming' | 'batch';
	shuffleSolutions: boolean;
}

export interface WebviewConfig {
	renderingMode: 'batch' | 'streaming';
	shuffleSolutions: boolean;
}
