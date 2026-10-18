/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import type { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { CodexSessionConfigKey, collaborationModeKind, getCodexAutonomousSessionConfig, migrateCodexPermissionValues, narrowAdditionalDirectories, narrowApprovalPolicy, narrowBoolean, narrowCodexPermissionsPreset, narrowPersonality, narrowReasoningEffort, narrowReasoningSummary, narrowSandboxMode, narrowWebSearchMode, presetForResolvedPermissions, resolveCodexPermissions, resolveCodexPermissionsPreset } from '../../../node/codex/codexSessionConfigKeys.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ISessionDataService } from '../../../common/sessionDataService.js';
import { CodexAgent } from '../../../node/codex/codexAgent.js';
import { ICodexProxyService } from '../../../node/codex/codexProxyService.js';
import { IAgentConfigurationService } from '../../../node/agentConfigurationService.js';
import { IAgentHostWorktreeIsolation, NullAgentHostWorktreeIsolation } from '../../../node/shared/worktreeIsolation.js';
import { IAgentHostCustomizationEnablementService } from '../../../node/agentHostCustomizationEnablementService.js';
import { IAgentSdkDownloader } from '../../../node/agentSdkDownloader.js';
import { RecordingAgentSdkDownloader } from '../testAgentSdkDownloader.js';
import { IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE } from '../../../common/agentHostCheckpointService.js';
import { IDardcorRouterService } from '../../../node/shared/dardcorRouterService.js';
import { SessionConfigKey } from '../../../common/sessionConfigKeys.js';
import { IAgentHostOTelService } from '../../../common/otel/agentHostOTelService.js';
import { IAgentHostSessionTitleSignal } from '../../../node/agentHostSessionTitleSignal.js';
import { createNoopCustomizationEnablementService } from '../testCustomizationEnablementService.js';
import { IAgentHostGitHubEndpointService } from '../../../node/agentHostGitHubEndpointService.js';
import { IAgentHostProxyResolver } from '../../../node/agentHostProxyResolver.js';
import { createTestGitHubEndpointService } from '../testGitHubEndpointService.js';
import { createTestAgentHostProxyResolver } from '../agentServiceTestUtils.js';

function createAgent(disposables: Pick<DisposableStore, 'add'>): CodexAgent {
	const instantiationService = new TestInstantiationService();
	const logService = new NullLogService();
	instantiationService.stub(ISessionDataService, { _serviceBrand: undefined });
	instantiationService.stub(IDardcorRouterService, { _serviceBrand: undefined });
	instantiationService.stub(ICodexProxyService, { _serviceBrand: undefined });
	instantiationService.stub(IAgentConfigurationService, {
		_serviceBrand: undefined,
		onDidRootConfigChange: Event.None,
		getRootValue: () => undefined,
	});
	instantiationService.stub(IAgentHostWorktreeIsolation, new NullAgentHostWorktreeIsolation());
	instantiationService.stub(IAgentHostCustomizationEnablementService, createNoopCustomizationEnablementService());
	instantiationService.stub(IAgentSdkDownloader, new RecordingAgentSdkDownloader());
	instantiationService.stub(IAgentHostCheckpointService, NULL_CHECKPOINT_SERVICE);
	instantiationService.stub(IAgentHostOTelService, { _serviceBrand: undefined, getNativeSdkTelemetryConfig: async () => undefined });
	instantiationService.stub(IAgentHostSessionTitleSignal, { _serviceBrand: undefined, onDidChangeSessionTitle: Event.None });
	instantiationService.stub(IAgentHostGitHubEndpointService, createTestGitHubEndpointService());
	instantiationService.stub(IAgentHostProxyResolver, createTestAgentHostProxyResolver());
	instantiationService.stub(IProductService, { _serviceBrand: undefined, version: '1.0.0-test' } as IProductService);
	instantiationService.stub(INativeEnvironmentService, { userHome: URI.file('/tmp') });
	instantiationService.stub(ILogService, logService);
	const agent = disposables.add(instantiationService.createInstance(CodexAgent));
	agent['_probeAccountAtStartup'] = async () => { };
	return agent;
}

suite('codexSessionConfigKeys', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('selects provider-native autonomous session config and respects policy', () => {
		assert.deepStrictEqual({
			selected: getCodexAutonomousSessionConfig(false),
			restricted: getCodexAutonomousSessionConfig(true),
		}, {
			selected: { [CodexSessionConfigKey.PermissionsPreset]: 'auto-review' },
			restricted: undefined,
		});
	});

	test('narrows valid values and rejects invalid values', () => {
		assert.deepStrictEqual({
			approvalPolicy: [narrowApprovalPolicy('never'), narrowApprovalPolicy('on-request'), narrowApprovalPolicy('nope')],
			sandboxMode: [narrowSandboxMode('read-only'), narrowSandboxMode('workspace-write'), narrowSandboxMode('folder')],
			permissionsPreset: [narrowCodexPermissionsPreset('default'), narrowCodexPermissionsPreset('full-access'), narrowCodexPermissionsPreset('yolo')],
			additionalDirectories: [narrowAdditionalDirectories(['/tmp/a', '', 1, '/tmp/b']), narrowAdditionalDirectories('nope')],
			boolean: [narrowBoolean(true), narrowBoolean(false), narrowBoolean('true')],
			webSearchMode: [narrowWebSearchMode('disabled'), narrowWebSearchMode('cached'), narrowWebSearchMode('online')],
			reasoningEffort: [narrowReasoningEffort('minimal'), narrowReasoningEffort('medium'), narrowReasoningEffort('max'), narrowReasoningEffort('ultra'), narrowReasoningEffort('extreme')],
			personality: [narrowPersonality('friendly'), narrowPersonality('pragmatic'), narrowPersonality('grumpy')],
			reasoningSummary: [narrowReasoningSummary('auto'), narrowReasoningSummary('detailed'), narrowReasoningSummary('verbose')],
			collaborationMode: [collaborationModeKind('plan'), collaborationModeKind('interactive'), collaborationModeKind(undefined)],
		}, {
			approvalPolicy: ['never', 'on-request', undefined],
			sandboxMode: ['read-only', 'workspace-write', undefined],
			permissionsPreset: ['default', 'full-access', undefined],
			additionalDirectories: [['/tmp/a', '/tmp/b'], undefined],
			boolean: [true, false, undefined],
			webSearchMode: ['disabled', 'cached', undefined],
			reasoningEffort: ['minimal', 'medium', 'max', 'ultra', undefined],
			personality: ['friendly', 'pragmatic', undefined],
			reasoningSummary: ['auto', 'detailed', undefined],
			collaborationMode: ['plan', 'default', 'default'],
		});
	});

	test('expands permissions presets and falls back to legacy axes', () => {
		const legacyDefaults = { approvalPolicy: 'on-request' as const, sandboxMode: 'workspace-write' as const };
		assert.deepStrictEqual({
			presets: {
				default: resolveCodexPermissionsPreset('default'),
				autoReview: resolveCodexPermissionsPreset('auto-review'),
				fullAccess: resolveCodexPermissionsPreset('full-access'),
			},
			fromPreset: resolveCodexPermissions({ [CodexSessionConfigKey.PermissionsPreset]: 'full-access' }, legacyDefaults),
			fromLegacyKeys: resolveCodexPermissions({ [CodexSessionConfigKey.SandboxMode]: 'read-only', [CodexSessionConfigKey.ApprovalPolicy]: 'never' }, legacyDefaults),
			fromDefaults: resolveCodexPermissions(undefined, legacyDefaults),
		}, {
			presets: {
				default: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalsReviewer: 'user' },
				autoReview: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalsReviewer: 'auto_review' },
				fullAccess: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalsReviewer: 'user' },
			},
			fromPreset: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalsReviewer: 'user' },
			fromLegacyKeys: { approvalPolicy: 'never', sandboxMode: 'read-only', approvalsReviewer: 'user' },
			fromDefaults: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalsReviewer: 'user' },
		});
	});

	test('resolveChatConfig exposes a single permissions-preset chip', async () => {
		const agent = createAgent(disposables);

		const defaulted = await agent.resolveChatConfig({ config: {} });
		const fullAccess = await agent.resolveChatConfig({ config: { [CodexSessionConfigKey.PermissionsPreset]: 'full-access' } });

		assert.deepStrictEqual({
			schemaProperties: Object.keys(defaulted.schema.properties).sort(),
			modeEnum: defaulted.schema.properties[SessionConfigKey.Mode].enum,
			defaultedValues: {
				mode: defaulted.values[SessionConfigKey.Mode],
				preset: defaulted.values[CodexSessionConfigKey.PermissionsPreset],
			},
			fullAccessPreset: fullAccess.values[CodexSessionConfigKey.PermissionsPreset],
		}, {
			schemaProperties: [SessionConfigKey.Mode, CodexSessionConfigKey.PermissionsPreset, SessionConfigKey.Permissions].sort(),
			modeEnum: ['interactive', 'plan'],
			defaultedValues: { mode: 'interactive', preset: 'default' },
			fullAccessPreset: 'full-access',
		});
	});

	test('inverts presets and migrates legacy axes without escalating', () => {
		const defaults = { approvalPolicy: 'on-request' as const, sandboxMode: 'workspace-write' as const };
		assert.deepStrictEqual({
			invert: {
				default: presetForResolvedPermissions(resolveCodexPermissionsPreset('default')),
				autoReview: presetForResolvedPermissions(resolveCodexPermissionsPreset('auto-review')),
				fullAccess: presetForResolvedPermissions(resolveCodexPermissionsPreset('full-access')),
				readOnly: presetForResolvedPermissions({ approvalPolicy: 'on-request', sandboxMode: 'read-only', approvalsReviewer: 'user' }),
			},
			explicit: migrateCodexPermissionValues({ [CodexSessionConfigKey.PermissionsPreset]: 'auto-review' }, defaults),
			migrated: migrateCodexPermissionValues({ [CodexSessionConfigKey.SandboxMode]: 'workspace-write', [CodexSessionConfigKey.ApprovalPolicy]: 'on-request' }, defaults),
			snappedDefault: migrateCodexPermissionValues({ [CodexSessionConfigKey.SandboxMode]: 'workspace-write', [CodexSessionConfigKey.ApprovalPolicy]: 'never' }, defaults),
			snappedFullAccess: migrateCodexPermissionValues({ [CodexSessionConfigKey.SandboxMode]: 'danger-full-access', [CodexSessionConfigKey.ApprovalPolicy]: 'on-request' }, defaults),
			preserved: migrateCodexPermissionValues({ [CodexSessionConfigKey.SandboxMode]: 'read-only' }, defaults),
			empty: migrateCodexPermissionValues(undefined, defaults),
		}, {
			invert: { default: 'default', autoReview: 'auto-review', fullAccess: 'full-access', readOnly: undefined },
			explicit: { [CodexSessionConfigKey.PermissionsPreset]: 'auto-review' },
			migrated: { [CodexSessionConfigKey.PermissionsPreset]: 'default' },
			snappedDefault: { [CodexSessionConfigKey.PermissionsPreset]: 'default' },
			snappedFullAccess: { [CodexSessionConfigKey.PermissionsPreset]: 'full-access' },
			preserved: { [CodexSessionConfigKey.ApprovalPolicy]: 'on-request', [CodexSessionConfigKey.SandboxMode]: 'read-only' },
			empty: { [CodexSessionConfigKey.PermissionsPreset]: 'default' },
		});
	});

	test('resolveChatConfig preserves legacy read-only permissions on restore', async () => {
		const agent = createAgent(disposables);
		const legacyDefaults = { approvalPolicy: 'on-request' as const, sandboxMode: 'workspace-write' as const };

		const legacy = await agent.resolveChatConfig({
			config: {
				[CodexSessionConfigKey.SandboxMode]: 'read-only',
				[CodexSessionConfigKey.ApprovalPolicy]: 'on-request',
				[CodexSessionConfigKey.ModelReasoningEffort]: 'high',
			},
		});
		const migratable = await agent.resolveChatConfig({
			config: {
				[CodexSessionConfigKey.SandboxMode]: 'danger-full-access',
				[CodexSessionConfigKey.ApprovalPolicy]: 'never',
			},
		});

		assert.deepStrictEqual({
			legacyPreset: legacy.values[CodexSessionConfigKey.PermissionsPreset],
			legacySandbox: legacy.values[CodexSessionConfigKey.SandboxMode],
			legacyEffective: resolveCodexPermissions(legacy.values, legacyDefaults),
			legacyEffort: legacy.values[CodexSessionConfigKey.ModelReasoningEffort],
			migratablePreset: migratable.values[CodexSessionConfigKey.PermissionsPreset],
			migratableSandbox: migratable.values[CodexSessionConfigKey.SandboxMode],
		}, {
			legacyPreset: undefined,
			legacySandbox: 'read-only',
			legacyEffective: { approvalPolicy: 'on-request', sandboxMode: 'read-only', approvalsReviewer: 'user' },
			legacyEffort: 'high',
			migratablePreset: 'full-access',
			migratableSandbox: undefined,
		});
	});
});
