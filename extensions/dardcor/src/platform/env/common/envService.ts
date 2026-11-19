/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event, WindowState } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { env } from '../../../util/dardcor/base/common/process';
import { URI } from '../../../util/dardcor/base/common/uri';
import { isPreRelease, isProduction, packageJson } from './packagejson';

export enum OperatingSystem {
	Windows = 'Windows',
	Macintosh = 'Mac',
	Linux = 'Linux'
}


export class NameAndVersion {
	constructor(
		readonly name: string,
		readonly version: string
	) { }

	format(): string {
		return `${this.name}/${this.version}`;
	}
}


export const IEnvService = createServiceIdentifier<IEnvService>('IEnvService');

export interface IEnvService {
	readonly _serviceBrand: undefined;
	readonly language: string | undefined;
	readonly sessionId: string;
	readonly machineId: string;
	readonly devDeviceId: string;
	readonly vscodeVersion: string;
	readonly isActive: boolean;
	readonly remoteName: string | undefined;
	readonly uiKind: 'desktop' | 'web';
	readonly OS: OperatingSystem;
	readonly uriScheme: string;
	readonly extensionId: string;
	readonly appRoot: string;
	readonly shell: string;
	readonly onDidChangeWindowState: Event<WindowState>;
	isProduction(): boolean;
	isPreRelease(): boolean;
	isSimulation(): boolean;
	getBuildType(): 'prod' | 'dev';
	getVersion(): string;
	getBuild(): string;
	getName(): string;
	getEditorInfo(): NameAndVersion;
	getEditorPluginInfo(): NameAndVersion;
	openExternal(target: URI): Promise<boolean>;
}

export const INativeEnvService = createServiceIdentifier<INativeEnvService>('INativeEnvService');
export interface INativeEnvService extends IEnvService {
	readonly _serviceBrand: undefined;
	userHome: URI;
}

export abstract class AbstractEnvService implements IEnvService {
	language: string | undefined;
	declare _serviceBrand: undefined;

	abstract get sessionId(): string;
	abstract get vscodeVersion(): string;
	abstract get extensionId(): string;
	abstract get machineId(): string;
	abstract get devDeviceId(): string;
	abstract get remoteName(): string | undefined;
	abstract get uiKind(): 'desktop' | 'web';
	abstract get OS(): OperatingSystem;
	abstract get uriScheme(): string;
	abstract get appRoot(): string;
	abstract get shell(): string;
	abstract get isActive(): boolean;
	abstract get onDidChangeWindowState(): Event<WindowState>;

	isProduction(): boolean {
		return isProduction;
	}

	isPreRelease(): boolean {
		return isPreRelease;
	}

	isSimulation(): boolean {
		return env['SIMULATION'] === '1';
	}

	getBuildType(): 'prod' | 'dev' {
		return packageJson.buildType;
	}

	getVersion(): string {
		return packageJson.version;
	}

	getBuild(): string {
		return packageJson.build;
	}

	getName(): string {
		return packageJson.name;
	}

	abstract getEditorInfo(): NameAndVersion;

	abstract getEditorPluginInfo(): NameAndVersion;

	abstract openExternal(target: URI): Promise<boolean>;
}

export function getEditorVersionHeaders(envService: IEnvService): { [key: string]: string } {
	return {
		'Editor-Version': envService.getEditorInfo().format(),
		'Editor-Plugin-Version': envService.getEditorPluginInfo().format(),
	};
}

export const isScenarioAutomation = env['IS_SCENARIO_AUTOMATION'] === '1';
