/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import { ConfigKey } from '../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { DEFAULT_OTLP_ENDPOINT } from '../../../platform/otel/common/otelConfig';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { IOTelSqliteStore, type OTelSqliteStore } from '../../../platform/otel/node/sqlite/otelSqliteStore';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import type { IExtensionContribution } from '../../common/contributions';

const OPEN_OTEL_SETTINGS_COMMAND = 'github.dardcor.chat.otel.openSettings';
const STATUS_ACTIVE_COMMAND = 'github.dardcor.chat.otel.statusActive';
const OTEL_ENABLED_EXPLICITLY_CONTEXT_KEY = 'github.dardcor.otel.enabledExplicitly';
const CHAT_STATUS_ITEM_ID = 'dardcor.otelStatus';
const DOCS_URL = 'https://www.dardcor-code.web.id/docs/dardcor/guides/monitoring-agents';

export class OTelContrib extends Disposable implements IExtensionContribution {

	constructor(
		@IOTelService private readonly _otelService: IOTelService,
		@IOTelSqliteStore private readonly _sqliteStore: OTelSqliteStore,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		super();
		if (this._otelService.config.enabled) {
			this._logService.info(`[OTel] Instrumentation enabled — exporter=${this._otelService.config.exporterType} endpoint=${this._otelService.config.otlpEndpoint} captureContent=${this._otelService.config.captureContent}`);
		} else {
			this._logService.trace('[OTel] Instrumentation disabled');
		}

		this._fireActivatedTelemetry();
		this._registerOpenSettingsCommand();
		this._logEndpointInfo();
		this._installVisibilityIndicators();
		this._configureTerminalEnv();

		this._register(vscode.commands.registerCommand('github.dardcor.chat.otel.flush', async () => {
			if (!this._otelService.config.enabled) {
				return;
			}
			this._logService.info('[OTel] Flush requested — exporting pending traces, metrics, and events');
			await this._otelService.flush();
			this._logService.info('[OTel] Flush complete');
		}));

		this._watchForReloadRequiredChanges();

		this._register(vscode.commands.registerCommand('github.dardcor.chat.otel.exportAgentTracesDB', async (savePath?: vscode.Uri | string) => {
			const dbPath = this._sqliteStore.dbPath;
			if (!dbPath) {
				return;
			}
			const src = vscode.Uri.file(dbPath);
			let dest: vscode.Uri;

			if (savePath) {
				const saveUri = typeof savePath === 'string' ? vscode.Uri.file(savePath) : savePath;
				dest = vscode.Uri.joinPath(saveUri, 'agent-traces.db');
			} else {
				const result = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(os.homedir() + '/agent-traces.db'),
					filters: { 'SQLite Database': ['db'] },
					title: 'Export Agent Traces DB',
				});
				if (!result) {
					return;
				}
				dest = result;
			}

			await this._otelService.flush();

			this._sqliteStore.checkpoint();

			await vscode.workspace.fs.copy(src, dest, { overwrite: true });
			this._logService.info(`[OTel] Exported agent-traces.db to ${dest.fsPath}`);

			this._telemetryService.sendMSFTTelemetryEvent('otel.exportAgentTracesDB', {
				interactive: String(!savePath),
			});
		}));
	}

	private _watchForReloadRequiredChanges(): void {
		const reloadSettings = [
			ConfigKey.Advanced.OTelEnabled,
			ConfigKey.Advanced.OTelExporterType,
			ConfigKey.Advanced.OTelOtlpEndpoint,
			ConfigKey.Advanced.OTelCaptureContent,
			ConfigKey.Advanced.OTelOutfile,
			ConfigKey.Advanced.OTelDbSpanExporter,
		];

		const initialValues = new Map(reloadSettings.map(s => [s.fullyQualifiedId, vscode.workspace.getConfiguration().get(s.fullyQualifiedId)]));

		this._register(vscode.workspace.onDidChangeConfiguration(async e => {
			const currentConfig = vscode.workspace.getConfiguration();
			const changedSettings = reloadSettings.filter(s =>
				e.affectsConfiguration(s.fullyQualifiedId) &&
				currentConfig.get(s.fullyQualifiedId) !== initialValues.get(s.fullyQualifiedId)
			);
			if (changedSettings.length === 0) {
				return;
			}
			const endpointSetting = ConfigKey.Advanced.OTelOtlpEndpoint;
			const endpointChanged = changedSettings.some(s => s.fullyQualifiedId === endpointSetting.fullyQualifiedId);
			const reloadWindowLabel = vscode.l10n.t("Reload Window");
			const message = endpointChanged
				? vscode.l10n.t("Dardcor AI OTel endpoint will change to {0} after reload.", String(currentConfig.get(endpointSetting.fullyQualifiedId)))
				: vscode.l10n.t("Dardcor AI OTel settings changed - a reload is required for the change to take effect.");
			const selection = await vscode.window.showInformationMessage(
				message,
				reloadWindowLabel,
			);
			if (selection === reloadWindowLabel) {
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		}));
	}

	private _installVisibilityIndicators(): void {
		if (!this._otelService.config.enabledExplicitly) {
			void vscode.commands.executeCommand('setContext', OTEL_ENABLED_EXPLICITLY_CONTEXT_KEY, false);
			return;
		}

		const chatStatusItem = this._register(vscode.window.createChatStatusItem(CHAT_STATUS_ITEM_ID));
		this._refreshChatStatusItem(chatStatusItem);
		void vscode.commands.executeCommand('setContext', OTEL_ENABLED_EXPLICITLY_CONTEXT_KEY, true);
	}

	private _refreshChatStatusItem(item: vscode.ChatStatusItem): void {
		const config = this._otelService.config;
		const destination = this._formatStatusDestination();
		const contentCaptureState = config.captureContent ? vscode.l10n.t('enabled') : vscode.l10n.t('not enabled');

		item.title = {
			label: vscode.l10n.t('Monitoring'),
			link: DOCS_URL,
			helpText: vscode.l10n.t('Monitor agent usage with OpenTelemetry.'),
		};
		item.description = vscode.l10n.t('Enabled');
		item.detail = vscode.l10n.t(
			"Agent behaviors and usage are monitored and exported to {0}.\nCapture of sensitive content including prompts, responses, and tool calls is {1}.\n[Manage](command:{2})",
			destination.detail,
			contentCaptureState,
			OPEN_OTEL_SETTINGS_COMMAND,
		);
		item.tooltip = vscode.l10n.t('Agent behaviors and usage are monitored and exported to {0}. Capture of sensitive content including prompts, responses, and tool calls is {1}.', destination.tooltip, contentCaptureState);
		item.show();
	}

	private _formatStatusDestination(): { readonly detail: string; readonly tooltip: string } {
		const config = this._otelService.config;
		switch (config.exporterType) {
			case 'console':
				return {
					detail: `\`${vscode.l10n.t('console exporter')}\``,
					tooltip: vscode.l10n.t('the console exporter'),
				};
			case 'file': {
				const filePath = config.fileExporterPath;
				if (!filePath || filePath === os.devNull) {
					return {
						detail: `\`${vscode.l10n.t('file exporter')}\``,
						tooltip: vscode.l10n.t('the file exporter'),
					};
				}
				const fileBaseName = filePath.replace(/^.*[\\/]/, '');
				return {
					detail: `\`${fileBaseName}\``,
					tooltip: filePath,
				};
			}
			case 'otlp-grpc':
			case 'otlp-http': {
				const host = this._formatEndpointHost(config.otlpEndpoint);
				return {
					detail: `\`${host}\``,
					tooltip: config.otlpEndpoint,
				};
			}
		}
	}

	private _logEndpointInfo(): void {
		const config = this._otelService.config;
		if (!config.enabled || !config.enabledExplicitly || !config.captureContent) {
			return;
		}
		if (config.exporterType === 'console' || config.exporterType === 'file') {
			return;
		}
		let host: string | undefined;
		try {
			host = new URL(config.otlpEndpoint).hostname.toLowerCase();
		} catch {
			this._logService.warn(`[OTel] captureContent is on but the OTLP endpoint is not a valid URL: ${config.otlpEndpoint}`);
			return;
		}
		const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
		if (!isLocal) {
			this._logService.info(`[OTel] captureContent is enabled; conversation content will be sent to ${config.otlpEndpoint}.`);
		}
	}

	private _configureTerminalEnv(): void {
		const collection = this._extensionContext.environmentVariableCollection;
		const otelKeys = [
			'DARDCOR_OTEL_ENABLED',
			'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
			'OTEL_EXPORTER_OTLP_ENDPOINT',
			'DARDCOR_OTEL_ENDPOINT',
			'DARDCOR_OTEL_EXPORTER_TYPE',
			'DARDCOR_OTEL_FILE_EXPORTER_PATH',
		];
		for (const key of otelKeys) {
			collection.delete(key);
		}

		const config = this._otelService.config;
		if (!config.enabledExplicitly) {
			return;
		}

		collection.replace('DARDCOR_OTEL_ENABLED', 'true');
		if (config.otlpEndpoint) {
			collection.replace('OTEL_EXPORTER_OTLP_ENDPOINT', config.otlpEndpoint);
		}
		collection.replace('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', String(config.captureContent));
	}

	private _registerOpenSettingsCommand(): void {
		this._register(vscode.commands.registerCommand(OPEN_OTEL_SETTINGS_COMMAND, async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'github.dardcor.chat.otel');
		}));

		this._register(vscode.commands.registerCommand(STATUS_ACTIVE_COMMAND, async () => {
			await vscode.commands.executeCommand(OPEN_OTEL_SETTINGS_COMMAND);
		}));
	}

	private _formatEndpointHost(endpoint: string): string {
		try {
			const url = new URL(endpoint);
			return url.host || url.origin || endpoint;
		} catch {
			return endpoint;
		}
	}

	override dispose(): void {
		this._sqliteStore.close();
		if (this._otelService.config.enabled) {
			this._logService.info('[OTel] Shutting down — flushing pending traces, metrics, and events');
		}
		this._otelService.shutdown().catch((err: Error) => {
			this._logService.error('[OTel] Error during shutdown:', String(err));
		});
		super.dispose();
	}

	private _fireActivatedTelemetry(): void {
		const config = this._otelService.config;
		this._telemetryService.sendMSFTTelemetryEvent('otel.activated', {
			enabled: String(config.enabled),
			enabledVia: config.enabledVia,
			dbSpanExporter: String(config.dbSpanExporter),
			exporterType: config.exporterType,
			captureContent: String(config.captureContent),
			protocol: config.otlpProtocol,
			hasCustomEndpoint: String(config.enabled && config.otlpEndpoint !== DEFAULT_OTLP_ENDPOINT && config.otlpEndpoint !== DEFAULT_OTLP_ENDPOINT + '/'),
			hasCustomServiceName: String(config.serviceName !== 'dardcor-chat'),
			hasResourceAttributes: String(Object.keys(config.resourceAttributes).length > 0),
		});
	}
}
