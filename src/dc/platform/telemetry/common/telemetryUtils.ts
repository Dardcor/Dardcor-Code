/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cloneAndChange, safeStringify } from '../../../base/common/objects.js';
import { isObject } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { LoggerGroup } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { getRemoteName } from '../../remote/common/remoteHosts.js';
import { verifyMicrosoftInternalDomain } from './commonProperties.js';
import { ICustomEndpointTelemetryService, ITelemetryData, ITelemetryEndpoint, ITelemetryService, TelemetryConfiguration, TelemetryLevel, TELEMETRY_CRASH_REPORTER_SETTING_ID, TELEMETRY_OLD_SETTING_ID, TELEMETRY_SETTING_ID } from './telemetry.js';

export class TelemetryTrustedValue<T> {
	public readonly isTrustedTelemetryValue = true;
	constructor(public readonly value: T) { }
}

export class NullTelemetryServiceShape implements ITelemetryService {
	declare readonly _serviceBrand: undefined;
	readonly telemetryLevel = TelemetryLevel.NONE;
	readonly sessionId = 'someValue.sessionId';
	readonly machineId = 'someValue.machineId';
	readonly sqmId = 'someValue.sqmId';
	readonly devDeviceId = 'someValue.devDeviceId';
	readonly firstSessionDate = 'someValue.firstSessionDate';
	readonly sendErrorTelemetry = false;
	publicLog() { }
	publicLog2() { }
	publicLogError() { }
	publicLogError2() { }
	setExperimentProperty() { }
	setCommonProperty() { }
}

export const NullTelemetryService = new NullTelemetryServiceShape();

export class NullEndpointTelemetryService implements ICustomEndpointTelemetryService {
	_serviceBrand: undefined;

	async publicLog(_endpoint: ITelemetryEndpoint, _eventName: string, _data?: ITelemetryData): Promise<void> {
	}

	async publicLogError(_endpoint: ITelemetryEndpoint, _errorEventName: string, _data?: ITelemetryData): Promise<void> {
	}
}

export const telemetryLogId = 'telemetry';
export const TelemetryLogGroup: LoggerGroup = { id: telemetryLogId, name: localize('telemetryLogName', "Telemetry") };

export interface ITelemetryAppender {
	log(eventName: string, data: ITelemetryData): void;
	flush(): Promise<void>;
}

export const NullAppender: ITelemetryAppender = { log: () => null, flush: () => Promise.resolve(undefined) };


export interface URIDescriptor {
	mimeType?: string;
	scheme?: string;
	ext?: string;
	path?: string;
}

export function supportsTelemetry(productService: IProductService, environmentService: IEnvironmentService): boolean {
	if (!environmentService.isBuilt && !environmentService.disableTelemetry) {
		return true;
	}
	return !(environmentService.disableTelemetry || !productService.enableTelemetry);
}

export function isLoggingOnly(productService: IProductService, environmentService: IEnvironmentService): boolean {
	if (environmentService.extensionTestsLocationURI) {
		return true;
	}
	if (environmentService.isBuilt) {
		return false;
	}

	if (environmentService.disableTelemetry) {
		return false;
	}

	if (productService.enableTelemetry && productService.aiConfig?.ariaKey) {
		return false;
	}

	return true;
}

export function getTelemetryLevel(configurationService: IConfigurationService): TelemetryLevel {
	const newConfig = configurationService.getValue<TelemetryConfiguration>(TELEMETRY_SETTING_ID);
	const crashReporterConfig = configurationService.getValue<boolean | undefined>(TELEMETRY_CRASH_REPORTER_SETTING_ID);
	const oldConfig = configurationService.getValue<boolean | undefined>(TELEMETRY_OLD_SETTING_ID);

	if (oldConfig === false || crashReporterConfig === false) {
		return TelemetryLevel.NONE;
	}

	switch (newConfig ?? TelemetryConfiguration.ON) {
		case TelemetryConfiguration.ON:
			return TelemetryLevel.USAGE;
		case TelemetryConfiguration.ERROR:
			return TelemetryLevel.ERROR;
		case TelemetryConfiguration.CRASH:
			return TelemetryLevel.CRASH;
		case TelemetryConfiguration.OFF:
			return TelemetryLevel.NONE;
	}
}

export interface Properties {
	[key: string]: string;
}

export interface Measurements {
	[key: string]: number;
}

export function validateTelemetryData(data?: unknown): { properties: Properties; measurements: Measurements } {

	const properties: Properties = {};
	const measurements: Measurements = {};

	const flat: Record<string, unknown> = {};
	flatten(data, flat);

	for (let prop in flat) {
		prop = prop.length > 150 ? prop.substr(prop.length - 149) : prop;
		const value = flat[prop];

		if (typeof value === 'number') {
			measurements[prop] = value;

		} else if (typeof value === 'boolean') {
			measurements[prop] = value ? 1 : 0;

		} else if (typeof value === 'string') {
			if (value.length > 8192) {
				console.warn(`Telemetry property: ${prop} has been trimmed to 8192, the original length is ${value.length}`);
			}
			properties[prop] = value.substring(0, 8191);

		} else if (typeof value !== 'undefined' && value !== null) {
			properties[prop] = String(value);
		}
	}

	return {
		properties,
		measurements
	};
}

interface IRemoteAuthoringConfig {
	remoteExtensionTips?: { readonly [remoteName: string]: unknown };
	virtualWorkspaceExtensionTips?: { readonly [remoteName: string]: unknown };
}

export function cleanRemoteAuthority(remoteAuthority: string | undefined, config: IRemoteAuthoringConfig): string {
	if (!remoteAuthority) {
		return 'none';
	}

	const remoteName = getRemoteName(remoteAuthority);

	const set1 = config?.remoteExtensionTips;
	if (set1 && Object.prototype.hasOwnProperty.call(set1, remoteName)) {
		return remoteName;
	}

	const set2 = config?.virtualWorkspaceExtensionTips;
	if (set2 && Object.prototype.hasOwnProperty.call(set2, remoteName)) {
		return remoteName;
	}

	return 'other';
}

function flatten(obj: unknown, result: Record<string, unknown>, order: number = 0, prefix?: string): void {
	if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
		return;
	}

	const source = obj as Record<string, unknown>;
	for (const item of Object.getOwnPropertyNames(source)) {
		const value = source[item];
		const index = prefix ? prefix + item : item;

		if (Array.isArray(value)) {
			result[index] = safeStringify(value);

		} else if (value instanceof Date) {
			result[index] = value.toISOString();

		} else if (isObject(value)) {
			if (order < 2) {
				flatten(value, result, order + 1, index + '.');
			} else {
				result[index] = safeStringify(value);
			}
		} else {
			result[index] = value;
		}
	}
}

export function isInternalTelemetry(productService: IProductService, configService: IConfigurationService) {
	const msftInternalDomains = productService.msftInternalDomains || [];
	const internalTesting = configService.getValue<boolean>('telemetry.internalTesting');
	return verifyMicrosoftInternalDomain(msftInternalDomains) || internalTesting;
}

interface IPathEnvironment {
	appRoot: string;
	extensionsPath: string;
	userDataPath: string;
	userHome: URI;
	tmpDir: URI;
}

export function getPiiPathsFromEnvironment(paths: IPathEnvironment): string[] {
	return [paths.appRoot, paths.extensionsPath, paths.userHome.fsPath, paths.tmpDir.fsPath, paths.userDataPath];
}


function anonymizeFilePaths(stack: string, cleanupPatterns: RegExp[]): string {

	if (!stack || (!stack.includes('/') && !stack.includes('\\'))) {
		return stack;
	}

	let updatedStack = stack;

	const cleanUpIndexes: [number, number][] = [];
	for (const regexp of cleanupPatterns) {
		while (true) {
			const result = regexp.exec(stack);
			if (!result) {
				break;
			}
			cleanUpIndexes.push([result.index, regexp.lastIndex]);
		}
	}

	const nodeModulesRegex = /(?:^|[\\\/])((node_modules|node_modules\.asar)[\\\/].*)$/;
	const vscodeExtensionsPathRegex = /^(.*?)((?:\.vscode(?:-[a-z]+)*|resources[\\\/]app)[\\\/]extensions[\\\/].*)$/i;
	const fileRegex = /(file:\/\/)?([a-zA-Z]:(\\\\|\\|\/)|(\\\\|\\|\/))?([\w\-\._@]+(\\\\|\\|\/))+[\w\-\._@]*/g;
	let lastIndex = 0;
	updatedStack = '';

	while (true) {
		const result = fileRegex.exec(stack);
		if (!result) {
			break;
		}

		const overlappingRange = cleanUpIndexes.some(([start, end]) => result.index < end && start < fileRegex.lastIndex);

		if (!overlappingRange) {
			const vscodeExtMatch = vscodeExtensionsPathRegex.exec(result[0]);
			if (vscodeExtMatch) {
				updatedStack += stack.substring(lastIndex, result.index) + '<REDACTED: user-file-path>/' + vscodeExtMatch[2];
			} else {
				const nodeModulesMatch = nodeModulesRegex.exec(result[0]);
				if (nodeModulesMatch) {
					updatedStack += stack.substring(lastIndex, result.index) + '<REDACTED: user-file-path>/' + nodeModulesMatch[1];
				} else {
					updatedStack += stack.substring(lastIndex, result.index) + '<REDACTED: user-file-path>';
				}
			}
			lastIndex = fileRegex.lastIndex;
		}
	}
	if (lastIndex < stack.length) {
		updatedStack += stack.substr(lastIndex);
	}

	return updatedStack;
}

const userDataRegexes = [
	{ label: 'URL', regex: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]*/ },
	{ label: 'Google API Key', regex: /AIza[A-Za-z0-9_\\\-]{35}/ },
	{ label: 'JWT', regex: /eyJ[0eXAiOiJKV1Qi|hbGci|a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/ },
	{ label: 'Slack Token', regex: /xox[pbar]\-[A-Za-z0-9]/ },
	{ label: 'GitHub Token', regex: /(gh[psuro]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})/ },
	{ label: 'Generic Secret', regex: /(key|token|sig|secret|signature|password|passwd|pwd|android:value)[^a-zA-Z0-9]/i },
	{ label: 'CLI Credentials', regex: /((login|psexec|(certutil|psexec)\.exe).{1,50}(\s-u(ser(name)?)?\s+.{3,100})?\s-(admin|user|vm|root)?p(ass(word)?)?\s+["']?[^$\-\/\s]|(^|[\s\r\n\\])net(\.exe)?.{1,5}(user\s+|share\s+\/user:| user -? secrets ? set) \s + [^ $\s \/])/ },
	{ label: 'Microsoft Entra ID', regex: /eyJ(?:0eXAiOiJKV1Qi|hbGci|[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.)/ },
	{ label: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ }
];

function redactIfPossibleUserInfo(value: string, probe: string = value): string {
	for (const secretRegex of userDataRegexes) {
		if (secretRegex.regex.test(probe)) {
			return `<REDACTED: ${secretRegex.label}>`;
		}
	}
	return value;
}

function removePropertiesWithPossibleUserInfo(property: string): string {
	if (!property) {
		return property;
	}

	let hasMatch = false;
	for (const secretRegex of userDataRegexes) {
		if (secretRegex.regex.test(property)) {
			hasMatch = true;
			break;
		}
	}
	if (!hasMatch) {
		return property;
	}

	if (!property.includes('\n')) {
		return redactIfPossibleUserInfo(property);
	}

	const lines = property.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const probe = i < lines.length - 1 ? lines[i] + '\n' : lines[i];
		lines[i] = redactIfPossibleUserInfo(lines[i], probe);
	}
	return lines.join('\n');
}


export function cleanData(data: ITelemetryData | undefined, cleanUpPatterns: RegExp[]): Record<string, unknown> {
	if (!data) {
		return {};
	}
	return cloneAndChange(data, value => {

		if (value instanceof TelemetryTrustedValue || Object.hasOwnProperty.call(value, 'isTrustedTelemetryValue')) {
			return value.value;
		}

		if (typeof value === 'string') {
			let updatedProperty = value.replaceAll('%20', ' ');

			updatedProperty = anonymizeFilePaths(updatedProperty, cleanUpPatterns);

			for (const regexp of cleanUpPatterns) {
				updatedProperty = updatedProperty.replace(regexp, '');
			}

			updatedProperty = removePropertiesWithPossibleUserInfo(updatedProperty);

			return updatedProperty;
		}
		return undefined;
	});
}

