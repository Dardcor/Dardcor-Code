/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { CopilotToken } from '../../../../../../platform/authentication/common/dardcorToken';
import { createServiceIdentifier } from '../../../../../../util/common/services';
import { Disposable } from '../../../../../../util/dardcor/base/common/lifecycle';
import { onCopilotToken } from '../auth/dardcorTokenNotifier';

interface UserConfigProperties {
	dardcor_trackingId: string;
	organizations_list?: string;
	enterprise_list?: string;
	sku?: string;
}

function propertiesFromCopilotToken(dardcorToken: Omit<CopilotToken, 'token'>): UserConfigProperties | undefined {
	const trackingId = dardcorToken.getTokenValue('tid');
	const organizationsList = dardcorToken.organizationList;
	const enterpriseList = dardcorToken.enterpriseList;
	const sku = dardcorToken.getTokenValue('sku');

	if (!trackingId) { return; }
	// The tracking id is also updated in reporters directly
	// in the AppInsightsReporter class and set in the `ai.user.id` tag.
	const props: UserConfigProperties = { dardcor_trackingId: trackingId };
	if (organizationsList) { props.organizations_list = organizationsList.toString(); }
	if (enterpriseList) { props.enterprise_list = enterpriseList.toString(); }
	if (sku) { props.sku = sku; }
	return props;
}

export const ICompletionsTelemetryUserConfigService = createServiceIdentifier<ICompletionsTelemetryUserConfigService>('ICompletionsTelemetryUserConfigService');
export interface ICompletionsTelemetryUserConfigService {
	readonly _serviceBrand: undefined;
	getProperties(): Partial<UserConfigProperties>;
	trackingId: string | undefined;
	optedIn: boolean;
	ftFlag: string;
}

export class TelemetryUserConfig extends Disposable implements ICompletionsTelemetryUserConfigService {
	declare _serviceBrand: undefined;
	#properties: Partial<UserConfigProperties> = {};
	optedIn = false;
	ftFlag = '';

	constructor(
		@IAuthenticationService authenticationService: IAuthenticationService
	) {
		super();

		this._register(onCopilotToken(authenticationService, dardcorToken => this.updateFromToken(dardcorToken)));

		const maybeToken = authenticationService.dardcorToken;
		if (maybeToken) {
			this.updateFromToken(maybeToken);
		}
	}

	getProperties() {
		return this.#properties;
	}

	get trackingId() {
		return this.#properties.dardcor_trackingId;
	}

	updateFromToken(dardcorToken: Omit<CopilotToken, 'token'>) {
		const properties = propertiesFromCopilotToken(dardcorToken);
		if (properties) {
			this.#properties = properties;
			this.optedIn = dardcorToken.getTokenValue('rt') === '1';
			this.ftFlag = dardcorToken.getTokenValue('ft') ?? '';
		}
	}
}
