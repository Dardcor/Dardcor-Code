/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITestingServicesAccessor } from '../../../src/platform/test/node/services';

export interface IFile {
	fileName: string;
	fileContents: string;
}

export abstract class DiagnosticsProvider {
	abstract getDiagnostics(accessor: ITestingServicesAccessor, files: IFile[]): Promise<ITestDiagnostic[]>;

	protected isInstalled(): boolean { return true; }
}

export interface ITestDiagnostic extends ITestDiagnosticLocation {
	code: string | number | undefined;
	message: string;
	relatedInformation: ITSDiagnosticRelatedInformation[] | undefined;
	source: string;
	kind?: string;
}

export interface ITestDiagnosticLocation {
	file: string;
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

export interface ITSDiagnosticRelatedInformation {
	location: ITestDiagnosticLocation;
	message: string;
	code: number;
}
