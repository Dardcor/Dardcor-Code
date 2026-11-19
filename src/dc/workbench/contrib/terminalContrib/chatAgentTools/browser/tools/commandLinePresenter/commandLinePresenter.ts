/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MaybePromise } from '../../../../../../../base/common/async.js';
import type { OperatingSystem } from '../../../../../../../base/common/platform.js';

export interface ICommandLinePresenter {
	present(options: ICommandLinePresenterOptions): MaybePromise<ICommandLinePresenterResult | undefined>;
}

export interface ICommandLinePresenterOptions {
	commandLine: ICommandLinePresentationInput;
	shell: string;
	os: OperatingSystem;
}

export interface ICommandLinePresentationInput {
	original?: string;
	forDisplay: string;
}

export interface ICommandLinePresenterResult {
	commandLine: string;

	language?: string;

	languageDisplayName?: string;

	processOtherPresenters?: boolean;
}
