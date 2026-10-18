/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../base/common/platform.js';
import { PolicyCategory } from '../../../base/common/policy.js';
import { localize } from '../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'update',
	order: 15,
	title: localize('updateConfigurationTitle', "Update"),
	type: 'object',
	properties: {
		'update.mode': {
			type: 'string',
			enum: ['none', 'manual', 'start', 'default'],
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure how Dardcor Code checks for and installs application updates."),
			tags: ['usesOnlineServices'],
			enumDescriptions: [
				localize('none', "Disable updates."),
				localize('manual', "Disable automatic background update checks. Updates will be available if you manually check for updates."),
				localize('start', "Check for updates only on startup. Disable automatic background update checks."),
				localize('default', "Check periodically. Supported Windows user installers can download and apply updates in the background; other packages may require manual installation.")
			],
			policy: {
				name: 'UpdateMode',
				category: PolicyCategory.Update,
				minimumVersion: '1.67',
				localization: {
					description: { key: 'updateMode', value: localize('updateMode', "Configure how Dardcor Code checks for and installs application updates."), },
					enumDescriptions: [
						{
							key: 'none',
							value: localize('none', "Disable updates."),
						},
						{
							key: 'manual',
							value: localize('manual', "Disable automatic background update checks. Updates will be available if you manually check for updates."),
						},
						{
							key: 'start',
							value: localize('start', "Check for updates only on startup. Disable automatic background update checks."),
						},
						{
							key: 'default',
							value: localize('default', "Check periodically. Supported Windows user installers can download and apply updates in the background; other packages may require manual installation."),
						}
					]
				},
			}
		},
		'update.channel': {
			type: 'string',
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure how Dardcor Code checks for and installs application updates."),
			deprecationMessage: localize('deprecated', "This setting is deprecated, please use '{0}' instead.", 'update.mode')
		},
		'update.enableWindowsBackgroundUpdates': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			title: localize('enableWindowsBackgroundUpdatesTitle', "Enable Background Updates"),
			description: localize('enableWindowsBackgroundUpdates', "Enable background download and installation for supported Windows user installations."),
			included: isWindows && !isWeb
		},
		'update.showReleaseNotes': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('showReleaseNotes', "Show release notes after a Dardcor Code update."),
			tags: ['usesOnlineServices'],
		},
		'update.showPostInstallInfo': {
			type: 'boolean',
			default: false,
			experiment: { mode: 'auto' },
			scope: ConfigurationScope.APPLICATION,
			description: localize('showPostInstallInfo', "Show a post-install update tooltip in the title bar instead of opening the release notes editor."),
			tags: ['usesOnlineServices']
		},
		'update.titleBar': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateTitleBar', "Show the update indicator in the title bar."),
			included: !isWeb
		}
	}
});
