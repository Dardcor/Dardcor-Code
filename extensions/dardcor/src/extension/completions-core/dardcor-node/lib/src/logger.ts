/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createServiceIdentifier } from '../../../../../util/common/services';
import { ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ICompletionsTelemetryService } from '../../bridge/src/completionsTelemetryServiceBridge';
import { telemetryException } from './telemetry';

export enum LogLevel {
	DEBUG = 4,
	INFO = 3,
	WARN = 2,
	ERROR = 1,
}

export const ICompletionsLogTargetService = createServiceIdentifier<ICompletionsLogTargetService>('ICompletionsLogTargetService');
export interface ICompletionsLogTargetService {
	readonly _serviceBrand: undefined;
	logIt(level: LogLevel, category: string, ...extra: unknown[]): void;
}

export class Logger {
	constructor(private readonly category: string) { }

	private log(logTarget: ICompletionsLogTargetService, level: LogLevel, ...extra: unknown[]) {
		logTarget.logIt(level, this.category, ...extra);
	}

	debug(logTarget: ICompletionsLogTargetService, ...extra: unknown[]) {
		this.log(logTarget, LogLevel.DEBUG, ...extra);
	}

	info(logTarget: ICompletionsLogTargetService, ...extra: unknown[]) {
		this.log(logTarget, LogLevel.INFO, ...extra);
	}

	warn(logTarget: ICompletionsLogTargetService, ...extra: unknown[]) {
		this.log(logTarget, LogLevel.WARN, ...extra);
	}

	error(logTarget: ICompletionsLogTargetService, ...extra: unknown[]) {
		this.log(logTarget, LogLevel.ERROR, ...extra);
	}

	exception(accessor: ServicesAccessor, error: unknown, origin: string) {
		if (error instanceof Error && error.name === 'Canceled' && error.message === 'Canceled') { return; }

		let message = origin;
		if (origin.startsWith('.')) {
			message = origin.substring(1);
			origin = `${this.category}${origin}`;
		}

		telemetryException(accessor.get(ICompletionsTelemetryService), error, origin);

		const safeError: Error = error instanceof Error ? error : new Error(`Non-error thrown: ${String(error)}`);
		this.log(accessor.get(ICompletionsLogTargetService), LogLevel.ERROR, `${message}:`, safeError);
	}
}

export const logger = new Logger('default');
