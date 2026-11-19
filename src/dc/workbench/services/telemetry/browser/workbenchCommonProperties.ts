/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import * as Platform from '../../../../base/common/platform.js';
import * as uuid from '../../../../base/common/uuid.js';
import { cleanRemoteAuthority } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { mixin } from '../../../../base/common/objects.js';
import { ICommonProperties, firstSessionDateStorageKey, lastSessionDateStorageKey, machineIdKey } from '../../../../platform/telemetry/common/telemetry.js';
import { Gesture } from '../../../../base/browser/touch.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';

function cleanUserAgent(userAgent: string): string {
	return userAgent.replace(/(\d+\.\d+)(\.\d+)+/g, '$1');
}

export function resolveWorkbenchCommonProperties(
	storageService: IStorageService,
	productService: IProductService,
	environmentService: IWorkbenchEnvironmentService,
	isInternalTelemetry: boolean,
	resolveAdditionalProperties?: () => { [key: string]: unknown },
): ICommonProperties {
	const { commit, version, embedderIdentifier: productIdentifier, removeTelemetryMachineId: removeMachineId } = productService ?? {};
	const result: ICommonProperties = Object.create(null);
	const firstSessionDate = storageService.get(firstSessionDateStorageKey, StorageScope.APPLICATION)!;
	const lastSessionDate = storageService.get(lastSessionDateStorageKey, StorageScope.APPLICATION)!;

	let machineId: string | undefined;
	if (!removeMachineId) {
		machineId = storageService.get(machineIdKey, StorageScope.APPLICATION);
		if (!machineId) {
			machineId = uuid.generateUuid();
			storageService.store(machineIdKey, machineId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	} else {
		machineId = `Redacted-${productIdentifier ?? 'web'}`;
	}


	result['common.firstSessionDate'] = firstSessionDate;
	result['common.lastSessionDate'] = lastSessionDate || '';
	result['common.isNewSession'] = !lastSessionDate ? '1' : '0';
	result['common.remoteAuthority'] = cleanRemoteAuthority(environmentService.remoteAuthority, productService);

	result['common.machineId'] = machineId;
	result['sessionID'] = uuid.generateUuid() + Date.now();
	result['commitHash'] = commit;
	result['version'] = version;
	result['common.platform'] = Platform.PlatformToString(Platform.platform);
	result['common.product'] = productIdentifier ?? 'web';
	result['common.userAgent'] = Platform.userAgent ? cleanUserAgent(Platform.userAgent) : undefined;
	result['common.isTouchDevice'] = String(Gesture.isTouchDevice());

	if (isInternalTelemetry) {
		result['common.msftInternal'] = isInternalTelemetry;
	}

	let seq = 0;
	const startTime = Date.now();
	Object.defineProperties(result, {
		'timestamp': {
			get: () => new Date(),
			enumerable: true
		},
		'common.timesincesessionstart': {
			get: () => Date.now() - startTime,
			enumerable: true
		},
		'common.sequence': {
			get: () => seq++,
			enumerable: true
		}
	});

	if (resolveAdditionalProperties) {
		mixin(result, resolveAdditionalProperties());
	}

	return result;
}

