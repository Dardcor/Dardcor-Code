/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { LogLevel } from '../../../../platform/log/common/log.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export const OUTPUT_MIME = 'text/x-code-output';

export const OUTPUT_MODE_ID = 'Log';

export const LOG_MIME = 'text/x-code-log-output';

export const LOG_MODE_ID = 'log';

export const OUTPUT_VIEW_ID = 'workbench.panel.output';

export const CONTEXT_IN_OUTPUT = new RawContextKey<boolean>('inOutput', false);
export const CONTEXT_ACTIVE_FILE_OUTPUT = new RawContextKey<boolean>('activeLogOutput', false);
export const CONTEXT_ACTIVE_LOG_FILE_OUTPUT = new RawContextKey<boolean>('activeLogOutput.isLog', false);
export const CONTEXT_ACTIVE_OUTPUT_LEVEL_SETTABLE = new RawContextKey<boolean>('activeLogOutput.levelSettable', false);
export const CONTEXT_ACTIVE_OUTPUT_LEVEL = new RawContextKey<string>('activeLogOutput.level', '');
export const CONTEXT_ACTIVE_OUTPUT_LEVEL_IS_DEFAULT = new RawContextKey<boolean>('activeLogOutput.levelIsDefault', false);
export const CONTEXT_OUTPUT_SCROLL_LOCK = new RawContextKey<boolean>(`outputView.scrollLock`, false);
export const ACTIVE_OUTPUT_CHANNEL_CONTEXT = new RawContextKey<string>('activeOutputChannel', '');
export const SHOW_TRACE_FILTER_CONTEXT = new RawContextKey<boolean>('output.filter.trace', true);
export const SHOW_DEBUG_FILTER_CONTEXT = new RawContextKey<boolean>('output.filter.debug', true);
export const SHOW_INFO_FILTER_CONTEXT = new RawContextKey<boolean>('output.filter.info', true);
export const SHOW_WARNING_FILTER_CONTEXT = new RawContextKey<boolean>('output.filter.warning', true);
export const SHOW_ERROR_FILTER_CONTEXT = new RawContextKey<boolean>('output.filter.error', true);
export const OUTPUT_FILTER_FOCUS_CONTEXT = new RawContextKey<boolean>('outputFilterFocus', false);
export const HIDE_CATEGORY_FILTER_CONTEXT = new RawContextKey<string>('output.filter.categories', '');

export interface IOutputViewFilters {
	readonly onDidChange: Event<void>;
	text: string;
	readonly includePatterns: string[];
	readonly excludePatterns: string[];
	trace: boolean;
	debug: boolean;
	info: boolean;
	warning: boolean;
	error: boolean;
	categories: string;
	toggleCategory(category: string): void;
	hasCategory(category: string): boolean;
}

export const IOutputService = createDecorator<IOutputService>('outputService');

export interface IOutputService {
	readonly _serviceBrand: undefined;

	readonly filters: IOutputViewFilters;

	getChannel(id: string): IOutputChannel | undefined;

	getChannelDescriptor(id: string): IOutputChannelDescriptor | undefined;

	getChannelDescriptors(): IOutputChannelDescriptor[];

	getActiveChannel(): IOutputChannel | undefined;

	showChannel(id: string, preserveFocus?: boolean): Promise<void>;

	readonly onActiveOutputChannel: Event<string>;

	registerCompoundLogChannel(channels: IOutputChannelDescriptor[]): string;

	saveOutputAs(outputPath?: URI, ...channels: IOutputChannelDescriptor[]): Promise<void>;

	canSetLogLevel(channel: IOutputChannelDescriptor): boolean;

	getLogLevel(channel: IOutputChannelDescriptor): LogLevel | undefined;

	setLogLevel(channel: IOutputChannelDescriptor, logLevel: LogLevel): void;
}

export enum OutputChannelUpdateMode {
	Append = 1,
	Replace,
	Clear
}

export interface ILogEntry {
	readonly range: Range;
	readonly timestamp: number;
	readonly timestampRange: Range;
	readonly logLevel: LogLevel;
	readonly logLevelRange: Range;
	readonly category: string | undefined;
}

export interface IOutputChannel {

	readonly id: string;

	readonly label: string;

	readonly uri: URI;

	getLogEntries(): readonly ILogEntry[];

	append(output: string): void;

	clear(): void;

	replace(output: string): void;

	update(mode: OutputChannelUpdateMode.Append): void;
	update(mode: OutputChannelUpdateMode, till: number): void;

	dispose(): void;
}

export const Extensions = {
	OutputChannels: 'workbench.contributions.outputChannels'
};

export interface IOutputChannelDescriptor {
	id: string;
	label: string;
	log: boolean;
	languageId?: string;
	source?: IOutputContentSource | ReadonlyArray<IOutputContentSource>;
	extensionId?: string;
	user?: boolean;
}

export interface ISingleSourceOutputChannelDescriptor extends IOutputChannelDescriptor {
	source: IOutputContentSource;
}

export interface IMultiSourceOutputChannelDescriptor extends IOutputChannelDescriptor {
	source: ReadonlyArray<IOutputContentSource>;
}

export function isSingleSourceOutputChannelDescriptor(descriptor: IOutputChannelDescriptor): descriptor is ISingleSourceOutputChannelDescriptor {
	return !!descriptor.source && !Array.isArray(descriptor.source);
}

export function isMultiSourceOutputChannelDescriptor(descriptor: IOutputChannelDescriptor): descriptor is IMultiSourceOutputChannelDescriptor {
	return Array.isArray(descriptor.source);
}

export interface IOutputContentSource {
	readonly name?: string;
	readonly resource: URI;
}

export interface IOutputChannelRegistry {

	readonly onDidRegisterChannel: Event<string>;
	readonly onDidRemoveChannel: Event<IOutputChannelDescriptor>;
	readonly onDidUpdateChannelSources: Event<IMultiSourceOutputChannelDescriptor>;

	registerChannel(descriptor: IOutputChannelDescriptor): void;

	updateChannelSources(id: string, sources: IOutputContentSource[]): void;

	getChannels(): IOutputChannelDescriptor[];

	getChannel(id: string): IOutputChannelDescriptor | undefined;

	removeChannel(id: string): void;
}

class OutputChannelRegistry extends Disposable implements IOutputChannelRegistry {
	private channels = new Map<string, IOutputChannelDescriptor>();

	private readonly _onDidRegisterChannel = this._register(new Emitter<string>());
	readonly onDidRegisterChannel = this._onDidRegisterChannel.event;

	private readonly _onDidRemoveChannel = this._register(new Emitter<IOutputChannelDescriptor>());
	readonly onDidRemoveChannel = this._onDidRemoveChannel.event;

	private readonly _onDidUpdateChannelFiles = this._register(new Emitter<IMultiSourceOutputChannelDescriptor>());
	readonly onDidUpdateChannelSources = this._onDidUpdateChannelFiles.event;

	public registerChannel(descriptor: IOutputChannelDescriptor): void {
		if (!this.channels.has(descriptor.id)) {
			this.channels.set(descriptor.id, descriptor);
			this._onDidRegisterChannel.fire(descriptor.id);
		}
	}

	public getChannels(): IOutputChannelDescriptor[] {
		const result: IOutputChannelDescriptor[] = [];
		this.channels.forEach(value => result.push(value));
		return result;
	}

	public getChannel(id: string): IOutputChannelDescriptor | undefined {
		return this.channels.get(id);
	}

	public updateChannelSources(id: string, sources: IOutputContentSource[]): void {
		const channel = this.channels.get(id);
		if (channel && isMultiSourceOutputChannelDescriptor(channel)) {
			channel.source = sources;
			this._onDidUpdateChannelFiles.fire(channel);
		}
	}

	public removeChannel(id: string): void {
		const channel = this.channels.get(id);
		if (channel) {
			this.channels.delete(id);
			this._onDidRemoveChannel.fire(channel);
		}
	}
}

Registry.add(Extensions.OutputChannels, new OutputChannelRegistry());
