/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptElementProps, PromptReference, TextChunk } from '@vscode/prompt-tsx';
import type * as vscode from 'vscode';
import { isScenarioAutomation } from '../../../../platform/env/common/envService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IIgnoreService } from '../../../../platform/ignore/common/ignoreService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { createFencedCodeBlock } from '../../../../util/common/markdown';
import { basename } from '../../../../util/dardcor/base/common/resources';
import { ExtensionMode } from '../../../../dardcorTypes';


export abstract class SafePromptElement<P extends BasePromptElementProps, S = void> extends PromptElement<P, S> {

	constructor(props: P,
		@IVSCodeExtensionContext protected readonly _contextService: IVSCodeExtensionContext,
		@ITelemetryService protected readonly _telemetryService: ITelemetryService,
		@ILogService protected readonly _logService: ILogService,
		@IIgnoreService protected readonly _ignoreService: IIgnoreService,
	) {
		super(props);
	}

	protected _handleFoulPrompt(): undefined {
		const err = new Error('BAD PROMPT');
		this._logService.error(err);

		if (this._contextService.extensionMode !== ExtensionMode.Production && !isScenarioAutomation) {
			throw err;
		}

		this._telemetryService.sendMSFTTelemetryErrorEvent('prompt.invalidreference', { stack: err.stack });
	}
}

export type CodeBlockProps = PromptElementProps<{
	readonly includeFilepath?: boolean;
	readonly uri: vscode.Uri;
	readonly code: string;
	readonly languageId?: string;
	readonly references?: PromptReference[];

	readonly lineBasedPriority?: boolean;

	readonly shouldTrim?: boolean;

	readonly fence?: string;
}>;

export class CodeBlock extends SafePromptElement<CodeBlockProps> {

	constructor(props: CodeBlockProps,
		@IVSCodeExtensionContext _contextService: IVSCodeExtensionContext,
		@ITelemetryService _telemetryService: ITelemetryService,
		@ILogService _logService: ILogService,
		@IIgnoreService _ignoreService: IIgnoreService,
		@IPromptPathRepresentationService private readonly _promptPathRepresentationService: IPromptPathRepresentationService,
	) {
		super(props, _contextService, _telemetryService, _logService, _ignoreService);
	}

	async render() {
		const isIgnored = this.props.uri ? await this._ignoreService.isIgnored(this.props.uri) : false;
		if (isIgnored) {
			return this._handleFoulPrompt();
		}
		const filePath = this.props.includeFilepath ? this._promptPathRepresentationService.getFilePath(this.props.uri) : undefined;
		const code = createFencedCodeBlock(this.props.languageId ?? '', this.props.code, this.props.shouldTrim ?? true, filePath, this.props.fence);
		const reference = this.props.references && <references value={this.props.references} />;

		if (this.props.lineBasedPriority) {
			const lines = code.split('\n');
			return <>
				{lines.map((line, i) => <TextChunk priority={i === lines.length - 1 ? lines.length : lines.length - i}>
					{i === 0 && reference}{line}{i === lines.length - 1 ? '' : '\n'}
				</TextChunk>)}
			</>;
		}

		return <TextChunk>{reference}{code}</TextChunk>;
	}
}

export type ExampleCodeBlockProps = PromptElementProps<{
	readonly examplePath?: string;
	readonly isSummarized?: boolean;
	readonly includeFilepath?: boolean;
	readonly range?: vscode.Range;
	readonly code: string;
	readonly languageId?: string;
	readonly shouldTrim?: boolean;
	readonly minNumberOfBackticks?: number;
}>;


export class ExampleCodeBlock extends SafePromptElement<ExampleCodeBlockProps> {
	constructor(props: ExampleCodeBlockProps,
		@IVSCodeExtensionContext _contextService: IVSCodeExtensionContext,
		@ITelemetryService _telemetryService: ITelemetryService,
		@ILogService _logService: ILogService,
		@IIgnoreService _ignoreService: IIgnoreService,
		@IPromptPathRepresentationService private readonly _promptPathRepresentationService: IPromptPathRepresentationService,
	) {
		super(props, _contextService, _telemetryService, _logService, _ignoreService);
	}

	async render() {
		const filePath = this.props.includeFilepath ? this._promptPathRepresentationService.getExampleFilePath(this.props.examplePath ?? '/path/to/file') : undefined;
		const code = createFencedCodeBlock(this.props.languageId ?? '', this.props.code, this.props.shouldTrim ?? true, filePath, this.props.minNumberOfBackticks);
		return <TextChunk>{code}</TextChunk>;
	}
}



export const enum UriMode {
	Basename,
	Path
}

export type UriProps = PromptElementProps<{
	value: vscode.Uri;
	mode?: UriMode;
}>;

export class Uri extends SafePromptElement<UriProps> {

	override get insertLineBreakBefore(): boolean {
		return false;
	}

	async render() {
		const isIgnored = await this._ignoreService.isIgnored(this.props.value);
		if (isIgnored) {
			return this._handleFoulPrompt();
		}

		let value: string;
		if (this.props.mode === UriMode.Path) {
			value = this.props.value.path;
		} else {
			value = basename(this.props.value);
		}
		return <>{value}</>;
	}
}
