/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IEnvService } from '../../../../../platform/env/common/envService';
import { RequestId } from '../../../../../platform/networking/common/fetch';
import { createServiceIdentifier } from '../../../../../util/common/services';
import { generateUuid } from '../../../../../util/dardcor/base/common/uuid';
import { IInstantiationService, ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ICompletionsTelemetryService } from '../../bridge/src/completionsTelemetryServiceBridge';
import {
	BuildInfo,
	dumpForTelemetry,
	formatNameAndVersion, ICompletionsEditorAndPluginInfo
} from './config';
import { ExpConfig } from './experiments/expConfig';
import { ICompletionsFeaturesService } from './experiments/featuresService';
import { FilterSettings } from './experiments/filters';
import { ExpServiceTelemetryNames } from './experiments/telemetryNames';
import { APIJsonData } from './openai/openai';
import { Prompt } from './prompt/prompt';
import { ICompletionsTelemetryUserConfigService } from './telemetry/userConfig';
import { ICompletionsPromiseQueueService } from './util/promiseQueue';

export enum TelemetryStore {
	Standard,
	Enhanced,
}

export namespace TelemetryStore {
	export function isEnhanced(store: TelemetryStore): boolean {
		return store === TelemetryStore.Enhanced;
	}
}

function isEnhanced(store: TelemetryStore): boolean {
	return store === TelemetryStore.Enhanced;
}

const ftTelemetryEvents = [
	'engine.prompt',
	'engine.completion',
	'ghostText.capturedAfterAccepted',
	'ghostText.capturedAfterRejected',
];

const MAX_PROPERTY_LENGTH = 8192;
const MAX_CONCATENATED_PROPERTIES = 21;

export type TelemetryProperties = { [key: string]: string };
export type TelemetryMeasurements = { [key: string]: number };


export class TelemetryData {
	properties: TelemetryProperties;
	measurements: TelemetryMeasurements;
	issuedTime: number;
	displayedTime?: number;

	private static keysExemptedFromSanitization: string[] = [
		ExpServiceTelemetryNames.featuresTelemetryPropertyName,
	];

	protected constructor(properties: TelemetryProperties, measurements: TelemetryMeasurements, issuedTime: number) {
		this.properties = properties;
		this.measurements = measurements;
		this.issuedTime = issuedTime;
	}

	static createAndMarkAsIssued(
		properties?: TelemetryProperties,
		measurements?: TelemetryMeasurements
	): TelemetryData {
		return new TelemetryData(properties || {}, measurements || {}, now());
	}

	extendedBy(properties?: TelemetryProperties, measurements?: TelemetryMeasurements): TelemetryData {
		const newProperties = { ...this.properties, ...properties };
		const newMeasurements = { ...this.measurements, ...measurements };
		const newData = new TelemetryData(newProperties, newMeasurements, this.issuedTime);
		newData.displayedTime = this.displayedTime;

		return newData;
	}

	markAsDisplayed(): void {
		if (this.displayedTime === undefined) {
			this.displayedTime = now();
		}
	}

	async extendWithExpTelemetry(accessor: ServicesAccessor): Promise<void> {
		const { filters, exp } = await accessor.get(ICompletionsFeaturesService).getFallbackExpAndFilters();
		exp.addToTelemetry(this);
		filters.addToTelemetry(this);
	}

	extendWithEditorAgnosticFields(accessor: ServicesAccessor): void {
		const envService = accessor.get(IEnvService);
		const editorAndPluginInfo = accessor.get(ICompletionsEditorAndPluginInfo);

		this.properties['editor_version'] = formatNameAndVersion(editorAndPluginInfo.getEditorInfo());
		this.properties['editor_plugin_version'] = formatNameAndVersion(
			editorAndPluginInfo.getEditorPluginInfo()
		);
		this.properties['client_machineid'] = envService.machineId;
		this.properties['client_sessionid'] = envService.sessionId;
		this.properties['dardcor_version'] = `dardcor/${BuildInfo.getVersion()}`;
		if (typeof process !== 'undefined') {
			this.properties['runtime_version'] = `node/${process.versions.node}`;
		}

		this.properties['common_extname'] = editorAndPluginInfo.getEditorPluginInfo().name;
		this.properties['common_extversion'] = editorAndPluginInfo.getEditorPluginInfo().version;
		this.properties['common_vscodeversion'] = formatNameAndVersion(editorAndPluginInfo.getEditorInfo());
	}

	extendWithConfigProperties(accessor: ServicesAccessor): void {
		const configProperties: { [key: string]: string } = dumpForTelemetry(accessor);
		configProperties['dardcor.build'] = BuildInfo.getBuild();
		configProperties['dardcor.buildType'] = BuildInfo.getBuildType();

		this.properties = { ...this.properties, ...configProperties };
	}

	extendWithRequestId(requestId: RequestId): void {
		const requestProperties = {
			headerRequestId: requestId.headerRequestId,
			serverExperiments: requestId.serverExperiments,
			deploymentId: requestId.deploymentId,
		};
		this.properties = { ...this.properties, ...requestProperties };
	}

	private static keysToRemoveFromStandardTelemetry: string[] = [
		'gitRepoHost',
		'gitRepoName',
		'gitRepoOwner',
		'gitRepoUrl',
		'gitRepoPath',
		'repo',
		'request_option_nwo',
		'userKind',
	];

	static maybeRemoveRepoInfoFromProperties(
		store: TelemetryStore,
		map: { [key: string]: string }
	): { [key: string]: string } {
		if (isEnhanced(store)) {
			return map;
		}
		const returnValue: { [key: string]: string } = {};
		for (const key in map) {
			if (!TelemetryData.keysToRemoveFromStandardTelemetry.includes(key)) {
				returnValue[key] = map[key];
			}
		}
		return returnValue;
	}

	sanitizeKeys(): void {
		this.properties = TelemetryData.sanitizeKeys(this.properties);
		this.measurements = TelemetryData.sanitizeKeys(this.measurements);
		for (const key in this.measurements) {
			if (isNaN(this.measurements[key])) {
				delete this.measurements[key];
			}
		}
	}

	multiplexProperties(): void {
		this.properties = TelemetryData.multiplexProperties(this.properties);
	}

	static sanitizeKeys<V>(map?: { [key: string]: V }): { [key: string]: V } {
		map = map || {};
		const returnValue: { [key: string]: V } = {};
		for (const key in map) {
			const newKey = TelemetryData.keysExemptedFromSanitization.includes(key) ? key : key.replace(/\./g, '_');
			returnValue[newKey] = map[key];
		}
		return returnValue;
	}

	static multiplexProperties(properties: TelemetryProperties): TelemetryProperties {
		const newProperties = { ...properties };
		for (const key in properties) {
			const value = properties[key];
			let remainingValueCharactersLength = value?.length ?? 0;
			if (remainingValueCharactersLength > MAX_PROPERTY_LENGTH) {
				let lastStartIndex = 0;
				let newPropertiesCount = 0;
				while (remainingValueCharactersLength > 0 && newPropertiesCount < MAX_CONCATENATED_PROPERTIES) {
					newPropertiesCount += 1;
					let propertyName = key;
					if (newPropertiesCount > 1) {
						propertyName = key + '_' + (newPropertiesCount < 10 ? '0' : '') + newPropertiesCount;
					}
					let offsetIndex = lastStartIndex + MAX_PROPERTY_LENGTH;
					if (remainingValueCharactersLength < MAX_PROPERTY_LENGTH) {
						offsetIndex = lastStartIndex + remainingValueCharactersLength;
					}
					newProperties[propertyName] = value.slice(lastStartIndex, offsetIndex);
					remainingValueCharactersLength -= MAX_PROPERTY_LENGTH;
					lastStartIndex += MAX_PROPERTY_LENGTH;
				}
			}
		}
		return newProperties;
	}

	updateMeasurements(now: number): void {
		const timeSinceIssued = now - this.issuedTime;
		this.measurements.timeSinceIssuedMs = timeSinceIssued;

		if (this.displayedTime !== undefined) {
			const timeSinceDisplayed = now - this.displayedTime;
			this.measurements.timeSinceDisplayedMs = timeSinceDisplayed;
		}

		if (this.measurements.current_time === undefined) {
			this.measurements.current_time = nowSeconds(now);
		}
	}

	async makeReadyForSending(
		accessor: ServicesAccessor,
		store: TelemetryStore,
		includeExp: 'IncludeExp' | 'SkipExp',
		now: number
	): Promise<void> {
		const instantiationService = accessor.get(IInstantiationService);
		this.extendWithConfigProperties(accessor);
		this.extendWithEditorAgnosticFields(accessor);
		this.sanitizeKeys();
		this.multiplexProperties();
		if (includeExp === 'IncludeExp') {
			await this.extendWithExpTelemetry(accessor);
		}
		this.updateMeasurements(now);
		Object.assign(this.properties, instantiationService.invokeFunction(createRequiredProperties));
	}
}

export class TelemetryWithExp extends TelemetryData {
	filtersAndExp: { filters: FilterSettings; exp: ExpConfig };

	constructor(
		properties: TelemetryProperties,
		measurements: TelemetryMeasurements,
		issuedTime: number,
		filtersAndExp: { filters: FilterSettings; exp: ExpConfig }
	) {
		super(properties, measurements, issuedTime);
		this.filtersAndExp = filtersAndExp;
	}

	override extendedBy(properties?: TelemetryProperties, measurements?: TelemetryMeasurements): TelemetryWithExp {
		const newProperties = { ...this.properties, ...properties };
		const newMeasurements = { ...this.measurements, ...measurements };
		const newData = new TelemetryWithExp(newProperties, newMeasurements, this.issuedTime, this.filtersAndExp);
		newData.displayedTime = this.displayedTime;

		return newData;
	}

	override extendWithExpTelemetry(): Promise<void> {
		this.filtersAndExp.exp.addToTelemetry(this);
		this.filtersAndExp.filters.addToTelemetry(this);
		return Promise.resolve();
	}

	static createEmptyConfigForTesting(): TelemetryWithExp {
		return new TelemetryWithExp({}, {}, 0, {
			filters: new FilterSettings({}),
			exp: ExpConfig.createEmptyConfig(),
		});
	}
}

function sendTelemetryEvent(
	completionsTelemetryService: ICompletionsTelemetryService,
	store: TelemetryStore,
	name: string,
	data: { properties: TelemetryProperties; measurements: TelemetryMeasurements }
): void {
	const properties = TelemetryData.maybeRemoveRepoInfoFromProperties(store, data.properties);
	if (!isEnhanced(store)) {
		completionsTelemetryService.sendGHTelemetryEvent(
			name,
			properties,
			data.measurements
		);
	} else {
		completionsTelemetryService.sendEnhancedGHTelemetryEvent(
			name,
			properties,
			data.measurements
		);
	}
}

function sendTelemetryErrorEvent(
	accessor: ServicesAccessor,
	store: TelemetryStore,
	name: string,
	data: { properties: TelemetryProperties; measurements: TelemetryMeasurements }
): void {
	const telemetryService = accessor.get(ICompletionsTelemetryService);
	const properties = TelemetryData.maybeRemoveRepoInfoFromProperties(store, data.properties);
	telemetryService.sendGHTelemetryErrorEvent(
		name,
		properties,
		data.measurements
	);
}

function sendFTTelemetryEvent(
	accessor: ServicesAccessor,
	store: TelemetryStore,
	name: string,
	data: { properties: TelemetryProperties; measurements: TelemetryMeasurements }
): void {
	if (!shouldSendFinetuningTelemetry(accessor)) {
		return;
	}
}

export function telemetrizePromptLength(prompt: Prompt): { [key: string]: number } {
	return {
		promptCharLen: prompt.prefix.length + (prompt.context?.reduce((sum, c) => sum + c.length, 0) ?? 0),
		promptSuffixCharLen: prompt.suffix.length,
	};
}

export function now(): number {
	return performance.now();
}

function nowSeconds(now: number): number {
	return Math.floor(now / 1000);
}

function shouldSendEnhanced(accessor: ServicesAccessor): boolean {
	return accessor.get(ICompletionsTelemetryUserConfigService).optedIn;
}

function shouldSendFinetuningTelemetry(accessor: ServicesAccessor): boolean {
	return accessor.get(ICompletionsTelemetryUserConfigService).ftFlag !== '';
}

export function telemetry(accessor: ServicesAccessor, name: string, telemetryData?: TelemetryData, store?: TelemetryStore) {
	return accessor.get(ICompletionsPromiseQueueService).register(_telemetry(accessor, name, now(), telemetryData?.extendedBy(), store));
}

async function _telemetry(
	accessor: ServicesAccessor,
	name: string,
	now: number,
	telemetryData?: TelemetryData,
	store = TelemetryStore.Standard
) {
	const completionsTelemetryService = accessor.get(ICompletionsTelemetryService);
	const instantiationService = accessor.get(IInstantiationService);

	const definedTelemetryData = telemetryData || TelemetryData.createAndMarkAsIssued({}, {});
	await definedTelemetryData.makeReadyForSending(accessor, store ?? false, 'IncludeExp', now);
	if (!isEnhanced(store) || instantiationService.invokeFunction(shouldSendEnhanced)) {
		sendTelemetryEvent(completionsTelemetryService, store, name, definedTelemetryData);
	}
	if (isEnhanced(store) && ftTelemetryEvents.includes(name) && instantiationService.invokeFunction(shouldSendFinetuningTelemetry)) {
		instantiationService.invokeFunction(sendFTTelemetryEvent, store, name, definedTelemetryData);
	}
}

export function telemetryExpProblem(accessor: ServicesAccessor, telemetryProperties: { reason: string }) {
	const promiseQueueService = accessor.get(ICompletionsPromiseQueueService);
	return promiseQueueService.register(_telemetryExpProblem(accessor, telemetryProperties, now()));
}

async function _telemetryExpProblem(accessor: ServicesAccessor, telemetryProperties: { reason: string }, now: number) {
	const completionsTelemetryService = accessor.get(ICompletionsTelemetryService);
	const name = 'expProblem';
	const definedTelemetryData = TelemetryData.createAndMarkAsIssued(telemetryProperties, {});
	await definedTelemetryData.makeReadyForSending(accessor, TelemetryStore.Standard, 'SkipExp', now);
	sendTelemetryEvent(completionsTelemetryService, TelemetryStore.Standard, name, definedTelemetryData);
}

export function telemetryRaw(
	accessor: ServicesAccessor,
	name: string,
	props: TelemetryProperties,
	measurements: TelemetryMeasurements
) {
	const completionsTelemetryService = accessor.get(ICompletionsTelemetryService);
	const properties = { ...props, ...createRequiredProperties(accessor) };
	sendTelemetryEvent(completionsTelemetryService, TelemetryStore.Standard, name, { properties, measurements });
}

function createRequiredProperties(accessor: ServicesAccessor) {
	const editorAndPluginInfo = accessor.get(ICompletionsEditorAndPluginInfo);
	const properties: TelemetryProperties = {
		unique_id: generateUuid(),
		common_extname: editorAndPluginInfo.getEditorPluginInfo().name,
		common_extversion: editorAndPluginInfo.getEditorPluginInfo().version,
		common_vscodeversion: formatNameAndVersion(editorAndPluginInfo.getEditorInfo()),
	};
	const telemetryConfig = accessor.get(ICompletionsTelemetryUserConfigService);
	return { ...telemetryConfig.getProperties(), ...properties };
}

export function telemetryException(
	telemetryService: ICompletionsTelemetryService,
	maybeError: unknown,
	transaction: string,
) {
	return telemetryService.sendGHTelemetryException(maybeError, transaction || '');
}

type TelemetryCatcher = (...args: never[]) => unknown;

export function telemetryCatch<F extends TelemetryCatcher>(
	completionsTelemetryService: ICompletionsTelemetryService,
	completionsPromiseQueueService: ICompletionsPromiseQueueService,
	fn: F,
	transaction: string,
): (...args: Parameters<F>) => void {
	const wrapped = async (...args: Parameters<F>) => {
		try {
			await fn(...args);
		} catch (error) {
			telemetryException(completionsTelemetryService, error, transaction);
		}
	};
	return (...args) => completionsPromiseQueueService.register(wrapped(...args));
}

export function telemetryError(accessor: ServicesAccessor, name: string, telemetryData?: TelemetryData, store?: TelemetryStore) {
	return accessor.get(ICompletionsPromiseQueueService).register(_telemetryError(accessor, name, now(), telemetryData?.extendedBy(), store));
}

async function _telemetryError(
	accessor: ServicesAccessor,
	name: string,
	now: number,
	telemetryData?: TelemetryData,
	store = TelemetryStore.Standard
) {
	if (isEnhanced(store) && !shouldSendEnhanced(accessor)) {
		return;
	}
	const instantiationService = accessor.get(IInstantiationService);
	const definedTelemetryData = telemetryData || TelemetryData.createAndMarkAsIssued({}, {});
	await definedTelemetryData.makeReadyForSending(accessor, store, 'IncludeExp', now);
	instantiationService.invokeFunction(sendTelemetryErrorEvent, store, name, definedTelemetryData);
}

export function logEngineCompletion(
	accessor: ServicesAccessor,
	completionText: string,
	jsonData: APIJsonData,
	requestId: RequestId,
	choiceIndex: number
) {
	const telemetryData = TelemetryData.createAndMarkAsIssued({
		completionTextJson: JSON.stringify(completionText),
		choiceIndex: choiceIndex.toString(),
	});

	if (jsonData.logprobs) {
		for (const [key, value] of Object.entries(jsonData.logprobs)) {
			telemetryData.properties['logprobs_' + key] = JSON.stringify(value) ?? 'unset';
		}
	}

	telemetryData.extendWithRequestId(requestId);
	return telemetry(accessor, 'engine.completion', telemetryData, TelemetryStore.Enhanced);
}

export function logEnginePrompt(accessor: ServicesAccessor, prompt: Prompt, telemetryData: TelemetryData) {
	const promptTelemetry: Record<string, string> = {
		promptJson: JSON.stringify({ prefix: prompt.prefix, context: prompt.context }),
		promptSuffixJson: JSON.stringify(prompt.suffix),
	};

	if (prompt.context) {
		const optionExtra = telemetryData.properties['request.option.extra']
			? (JSON.parse(telemetryData.properties['request.option.extra']) as Record<string, unknown>)
			: {};
		optionExtra.context = prompt.context;
		promptTelemetry['request.option.extra'] = JSON.stringify(optionExtra);
	}

	const telemetryDataWithPrompt = telemetryData.extendedBy(promptTelemetry);
	return telemetry(accessor, 'engine.prompt', telemetryDataWithPrompt, TelemetryStore.Enhanced);
}

export abstract class DardcorTelemetryReporter {
	abstract sendTelemetryEvent(
		eventName: string,
		properties?: {
			[key: string]: string;
		},
		measurements?: {
			[key: string]: number;
		}
	): void;
	abstract sendTelemetryErrorEvent(
		eventName: string,
		properties?: {
			[key: string]: string;
		},
		measurements?: {
			[key: string]: number;
		},
		errorProps?: string[]
	): void;
	abstract dispose(): Promise<void>;
}

export const ICompletionsTelemetryReporters = createServiceIdentifier<ICompletionsTelemetryReporters>('ICompletionsTelemetryReporters');
export interface ICompletionsTelemetryReporters {
	readonly _serviceBrand: undefined;
	getReporter(accessor: ServicesAccessor, store?: TelemetryStore): DardcorTelemetryReporter | undefined;
	getEnhancedReporter(accessor: ServicesAccessor): DardcorTelemetryReporter | undefined;
	getFTReporter(accessor: ServicesAccessor): DardcorTelemetryReporter | undefined;
	setReporter(reporter: DardcorTelemetryReporter): void;
	setEnhancedReporter(reporter: DardcorTelemetryReporter): void;
	setFTReporter(reporter: DardcorTelemetryReporter): void;
	deactivate(): Promise<void>;
}

export class TelemetryReporters implements ICompletionsTelemetryReporters {
	declare _serviceBrand: undefined;

	private reporter: DardcorTelemetryReporter | undefined;
	private reporterEnhanced: DardcorTelemetryReporter | undefined;
	private reporterFT: DardcorTelemetryReporter | undefined;

	getReporter(accessor: ServicesAccessor, store = TelemetryStore.Standard): DardcorTelemetryReporter | undefined {
		return isEnhanced(store) ? this.getEnhancedReporter(accessor) : this.reporter;
	}
	getEnhancedReporter(accessor: ServicesAccessor): DardcorTelemetryReporter | undefined {
		if (shouldSendEnhanced(accessor)) {
			return this.reporterEnhanced;
		}
		return undefined;
	}

	getFTReporter(accessor: ServicesAccessor): DardcorTelemetryReporter | undefined {
		return undefined;
	}

	setReporter(reporter: DardcorTelemetryReporter): void {
		this.reporter = reporter;
	}
	setEnhancedReporter(reporter: DardcorTelemetryReporter): void {
		this.reporterEnhanced = reporter;
	}

	setFTReporter(reporter: DardcorTelemetryReporter): void {
		this.reporterFT = reporter;
	}

	async deactivate(): Promise<void> {
		const reporters = [this.reporter, this.reporterEnhanced, this.reporterFT];
		this.reporter = this.reporterEnhanced = this.reporterFT = undefined;
		await Promise.all(reporters.map(r => r?.dispose()));
	}
}
