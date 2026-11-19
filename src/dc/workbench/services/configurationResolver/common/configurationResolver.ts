/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../../base/common/collections.js';
import { ErrorNoTelemetry } from '../../../../base/common/errors.js';
import { IProcessEnvironment } from '../../../../base/common/platform.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceFolderData } from '../../../../platform/workspace/common/workspace.js';
import { ConfigurationResolverExpression } from './configurationResolverExpression.js';

export const IConfigurationResolverService = createDecorator<IConfigurationResolverService>('configurationResolverService');

export interface IConfigurationResolverService {
	readonly _serviceBrand: undefined;

	readonly resolvableVariables: ReadonlySet<string>;

	resolveWithEnvironment(environment: IProcessEnvironment, folder: IWorkspaceFolderData | undefined, value: string): Promise<string>;

	resolveAsync<T>(folder: IWorkspaceFolderData | undefined, config: T): Promise<T extends ConfigurationResolverExpression<infer R> ? R : T>;

	resolveWithInteractionReplace(folder: IWorkspaceFolderData | undefined, config: unknown, section?: string, variables?: IStringDictionary<string>, target?: ConfigurationTarget): Promise<any>;

	resolveWithInteraction(folder: IWorkspaceFolderData | undefined, config: unknown, section?: string, variables?: IStringDictionary<string>, target?: ConfigurationTarget): Promise<Map<string, string> | undefined>;

	contributeVariable(variable: string, resolution: () => Promise<string | undefined>): void;
}

interface PromptStringInputInfo {
	id: string;
	type: 'promptString';
	description: string;
	default?: string;
	password?: boolean;
}

interface PickStringInputInfo {
	id: string;
	type: 'pickString';
	description: string;
	options: (string | { value: string; label?: string })[];
	default?: string;
}

interface CommandInputInfo {
	id: string;
	type: 'command';
	command: string;
	args?: any;
}

export type ConfiguredInput = PromptStringInputInfo | PickStringInputInfo | CommandInputInfo;

export enum VariableKind {
	Unknown = 'unknown',

	Env = 'env',
	Config = 'config',
	Command = 'command',
	Input = 'input',
	ExtensionInstallFolder = 'extensionInstallFolder',
	TaskVar = 'taskVar',

	WorkspaceFolder = 'workspaceFolder',
	Cwd = 'cwd',
	WorkspaceFolderBasename = 'workspaceFolderBasename',
	UserHome = 'userHome',
	LineNumber = 'lineNumber',
	ColumnNumber = 'columnNumber',
	SelectedText = 'selectedText',
	File = 'file',
	FileWorkspaceFolder = 'fileWorkspaceFolder',
	FileWorkspaceFolderBasename = 'fileWorkspaceFolderBasename',
	RelativeFile = 'relativeFile',
	RelativeFileDirname = 'relativeFileDirname',
	FileDirname = 'fileDirname',
	FileExtname = 'fileExtname',
	FileBasename = 'fileBasename',
	FileBasenameNoExtension = 'fileBasenameNoExtension',
	FileDirnameBasename = 'fileDirnameBasename',
	ExecPath = 'execPath',
	ExecInstallFolder = 'execInstallFolder',
	PathSeparator = 'pathSeparator',
	PathSeparatorAlias = '/'
}

export const allVariableKinds = Object.values(VariableKind).filter((value): value is VariableKind => typeof value === 'string');

export class VariableError extends ErrorNoTelemetry {
	constructor(public readonly variable: VariableKind, message?: string) {
		super(message);
	}
}
