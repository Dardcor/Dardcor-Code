/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isLinuxSnap, platform, Platform, PlatformToString } from '../../../base/common/platform.js';
import { env, platform as nodePlatform } from '../../../base/common/process.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ICommonProperties } from './telemetry.js';

function getPlatformDetail(hostname: string): string | undefined {
	if (platform === Platform.Linux && /^penguin(\.|$)/i.test(hostname)) {
		return 'chromebook';
	}

	return undefined;
}

export function resolveCommonProperties(
	release: string,
	hostname: string,
	arch: string,
	commit: string | undefined,
	version: string | undefined,
	machineId: string | undefined,
	sqmId: string | undefined,
	devDeviceId: string | undefined,
	isInternalTelemetry: boolean,
	releaseDate: string | undefined,
	product?: string,
): ICommonProperties {
	const result: ICommonProperties = Object.create(null);

	result['common.machineId'] = machineId;
	result['common.sqmId'] = sqmId;
	result['common.devDeviceId'] = devDeviceId;
	result['sessionID'] = generateUuid() + Date.now();
	result['commitHash'] = commit;
	result['version'] = version;
	result['common.releaseDate'] = releaseDate;
	result['common.platformVersion'] = (release || '').replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
	result['common.platform'] = PlatformToString(platform);
	result['common.nodePlatform'] = nodePlatform;
	result['common.nodeArch'] = arch;
	result['common.product'] = product || 'desktop';

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

	if (isLinuxSnap) {
		result['common.snap'] = 'true';
	}

	const platformDetail = getPlatformDetail(hostname);

	if (platformDetail) {
		result['common.platformDetail'] = platformDetail;
	}

	return result;
}

export function verifyMicrosoftInternalDomain(domainList: readonly string[]): boolean {
	const userDnsDomain = env['USERDNSDOMAIN'];
	if (!userDnsDomain) {
		return false;
	}

	const domain = userDnsDomain.toLowerCase();
	return domainList.some(msftDomain => domain === msftDomain);
}
