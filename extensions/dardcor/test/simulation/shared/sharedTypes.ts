/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Raw } from '@vscode/prompt-tsx';


export const SIMULATION_EXPLICIT_LOG_FILENAME = 'sim-log.md';
export const EXPLICIT_LOG_TAG = 'explicit-log-tag';

export const SIMULATION_IMPLICIT_LOG_FILENAME = 'sim-log.txt';
export const IMPLICIT_LOG_TAG = 'implicit-log-tag';

export const SIMULATION_REQUESTS_FILENAME = 'sim-requests.txt';
export const REQUESTS_TAG = 'requests-tag';

export const INLINE_INITIAL_DOC_TAG = 'inline-initial-doc-tag';
export const INLINE_CHANGED_DOC_TAG = 'inline-changed-doc-tag';
export const INLINE_STATE_TAG = 'inline-state-tag';
export const INLINE_NOTEBOOK_EXECUTION_TAG = 'inline-notebook-execution-tag';

export const SIDEBAR_RAW_RESPONSE_TAG = 'sidebar-raw-response-tag';

export const NES_USER_EDITS_HISTORY_TAG = 'nes-user-edits-history-tag';
export const NES_LOG_CONTEXT_TAG = 'nes-log-context-tag';
export const NEXT_EDIT_SUGGESTION_TAG = 'next-edit-suggestion-tag';

export const SIMULATION_FOLDER_NAME = '.simulation';
export const STDOUT_FILENAME = 'stdout.json.txt';
export const OLD_BASELINE_FILENAME = 'baseline.old.json.txt';
export const PRODUCED_BASELINE_FILENAME = 'baseline.produced.json.txt';
export const AML_OUTPUT_PATH = 'test/aml/out';
export const REPORT_FILENAME = 'report.json';
export const SCORECARD_FILENAME = 'scorecard.csv';
export const RUN_METADATA = 'metadata.json';

export interface ISerialisedChatMessage {
	role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
	content: string | ISerializedChatCompletionContentPart[];
	tool_calls?: Raw.ChatMessageToolCall[];
	tool_call_id?: string;
	name?: string;
}

export type ISerializedChatCompletionContentPart = Raw.ChatCompletionContentPart;

export interface ISerializedChatCompletionContentPartImage {
	type: 'text';
	text: string;
}

export interface ISerializedChatCompletionContentPartText {
	type: 'image_url';
	image_url: ISerializedChatCompletionContentPartImage.ISerializedImageURL;
}

export namespace ISerializedChatCompletionContentPartImage {
	export interface ISerializedImageURL {
		url: string;


		detail?: 'low' | 'high';
	}
}


export interface ICopilotFunctionCall {
	name: string;
	arguments: string;
	id?: string;
}

export type ISerialisedChatResponse = {
	type?: 'success' | 'filtered' | 'length' | string;
	value?: string[];
	requestId?: string;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		prompt_tokens_details?: {
			cached_tokens: number;
		};
	};
	dardcorFunctionCalls?: ICopilotFunctionCall[];
	truncatedValue?: string;

	isCacheHit?: boolean;
	cacheKey?: string;
	cacheMetadata?: {
		requestDuration: number;
		requestTime: string;
	};
};


export class InterceptedRequest {
	constructor(
		public readonly requestMessages: string | ISerialisedChatMessage[],
		public readonly requestOptions: { [key: string]: any },
		public readonly response: ISerialisedChatResponse,
		public readonly cacheKey: string | undefined,
		public readonly model: string | undefined,
		public readonly duration?: number
	) {
	}

	static fromJSON(json: any): InterceptedRequest {
		const request = new InterceptedRequest(json.requestMessages, json.requestOptions, json.response, json.cacheKey, json.model, json.duration);
		return request;
	}

	toJSON(): any {
		return {
			requestMessages: this.requestMessages,
			requestOptions: this.requestOptions,
			response: this.response,
			cacheKey: this.cacheKey,
			model: this.model,
			duration: this.duration
		};
	}
}

export interface ISerializedNesUserEditsHistory {
	edits: ISerializedFileEdit[];
	currentDocumentIndex: number;
}

export interface ISerializedFileEdit {
	languageId: string;
	original: string;
	modified: string;
	id?: string;
}

export type SimulationTestOutcome = (
	| { kind: 'edit'; files: Array<{ srcUri: string; post: string }> | string[] }
	| { kind: 'failed'; hitContentFilter: boolean; error: string | undefined; critical: boolean }
	| { kind: 'answer'; content: string }
) & { annotations?: OutputAnnotation[] };

export interface IBaselineTestSummary {
	readonly name: string;
	readonly optional?: boolean;
	readonly contentFilterCount: number;
	readonly passCount: number;
	readonly failCount: number;
	readonly score: number;
	readonly attributes: Record<string, string | number> | undefined;
}

export enum OutputType {
	detectedTest = 'detectedTest',
	detectedSuite = 'detectedSuite',
	initialTestSummary = 'initialTestSummary',
	skippedTest = 'skippedTest',
	testRunStart = 'testRunStart',
	testRunEnd = 'testRunEnd',
	terminated = 'terminated',
	deviceCodeCallback = 'deviceCodeCallback',
}

export interface IDetectedTestOutput {
	type: OutputType.detectedTest;
	name: string;
	suiteName: string;
	location?: ITestLocation;
}

export interface IDetectedSuiteOutput {
	type: OutputType.detectedSuite;
	name: string;
	location?: ITestLocation;
}

export interface ISkippedTestOutput {
	type: OutputType.skippedTest;
	name: string;
}

export interface IInitialTestSummaryOutput {
	type: OutputType.initialTestSummary;
	runOutputFolderName: string;
	testsToRun: string[];
	nRuns: number;
}

export interface ITestRunStartOutput {
	type: OutputType.testRunStart;
	name: string;
	runNumber: number;
}

export interface ITestRunEndOutput {
	type: OutputType.testRunEnd;
	name: string;
	runNumber: number;
	duration: number;
	pass: boolean;
	explicitScore: number | undefined;
	annotations?: OutputAnnotation[];
	error?: string;
	writtenFiles: IWrittenFile[];
	averageRequestDuration: number | undefined;
	requestCount: number | undefined;
	hasCacheMiss: boolean | undefined;
}

export interface ITerminated {
	type: OutputType.terminated;
	reason: string;
}

export interface IDeviceCodeCallbackOutput {
	type: OutputType.deviceCodeCallback;
	url: string;
}

export interface IWrittenFile {
	relativePath: string;
	tag: string;
}

export type RunOutput = IInitialTestSummaryOutput
	| ISkippedTestOutput
	| ITestRunStartOutput
	| ITestRunEndOutput
	| ITerminated
	| IDeviceCodeCallbackOutput
	;

export type Output = IDetectedTestOutput
	| IDetectedSuiteOutput
	| IInitialTestSummaryOutput
	| ISkippedTestOutput
	| ITestRunStartOutput
	| ITestRunEndOutput
	| ITerminated
	| IDeviceCodeCallbackOutput
	;

export interface IAdhocRequest {
	readonly system: string;
	readonly user: string;
	readonly model: string;
}

export enum AdhocResponseType {
	delta = 'adhocResponseDelta',
	done = 'adhocResponseDone',
	error = 'adhocResponseError',
}

export interface IAdhocResponseDelta {
	readonly type: AdhocResponseType.delta;
	readonly value: string;
}

export interface IAdhocResponseDone {
	readonly type: AdhocResponseType.done;
	readonly value: string;
}

export interface IAdhocResponseError {
	readonly type: AdhocResponseType.error;
	readonly value: string;
}

export type AdhocResponseOutput = IAdhocResponseDelta | IAdhocResponseDone | IAdhocResponseError;

export interface IRange {
	readonly start: IPosition;
	readonly end: IPosition;
}

export interface IPosition {
	readonly line: number;
	readonly character: number;
}

export interface ITestLocation {
	path: string;
	position: IPosition;
}

export interface IInteractionInfo {
	query: string;
	actualIntent: string | undefined;
	detectedIntent: string | undefined;
}

export interface IWorkspaceStateFile {
	workspacePath: string;
	relativeDiskPath: string;
	languageId: string | undefined;
}

export interface IInteractionWorkspaceState {
	kind: 'interaction';
	changedFiles: IWorkspaceStateFile[];
	fileName?: string;
	languageId?: string;
	selection?: IRange;
	range?: IRange;
	diagnostics: { [workspacePath: string]: IDiagnosticComparison } | undefined;
	interaction: IInteractionInfo;
	requestCount: number;
	annotations?: OutputAnnotation[];
}

export type OutputAnnotation = { severity: string; label: string; message: string };

export interface IInitialWorkspaceState {
	kind: 'initial';
	file?: IWorkspaceStateFile;
	additionalFiles: IWorkspaceStateFile[] | undefined;
	languageId?: string;
	selection?: IRange;
	diagnostics: IDiagnostic[];
	range?: IRange;
}

export interface IDiagnostic {
	range: IRange;
	message: string;
}

export type IDiagnosticComparison = { before: IDiagnostic[]; after: IDiagnostic[] };

export type IWorkspaceState = IInitialWorkspaceState | IInteractionWorkspaceState;

export function generateOutputFolderName(prefix?: string): string {
	const twodigits = (n: number) => String(n).padStart(2, '0');
	const d = new Date();
	const date = `${d.getFullYear()}${twodigits(d.getMonth() + 1)}${twodigits(d.getDate())}`;
	const time = `${twodigits(d.getHours())}${twodigits(d.getMinutes())}${twodigits(d.getSeconds())}`;
	const prefixPart = prefix ? `${prefix}-` : '';
	return `out-${prefixPart}${date}-${time}`;
}
