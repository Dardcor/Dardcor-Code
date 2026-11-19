/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, debouncedObservable, derived, IObservable, ISettableObservable, ObservablePromise, observableValue } from '../../../../base/common/observable.js';
import { basename } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Range } from '../../../../editor/common/core/range.js';
import { localize } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IChatWidget, IChatWidgetService } from '../../chat/browser/chat.js';
import { ChatContextPick, IChatContextPicker, IChatContextPickerItem, IChatContextPickService } from '../../chat/browser/attachments/chatContextPickService.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { IChatRequestFileEntry, IChatRequestVariableEntry, IDebugVariableEntry } from '../../chat/common/attachments/chatVariableEntries.js';
import { IDebugService, IExpression, IScope, IStackFrame, State } from '../common/debug.js';
import { Variable } from '../common/debugModel.js';

const enum PickerMode {
	Main = 'main',
	Expression = 'expression',
}

class DebugSessionContextPick implements IChatContextPickerItem {
	readonly type = 'pickerPick';
	readonly label = localize('chatContext.debugSession', 'Debug Session...');
	readonly icon = Codicon.debug;
	readonly ordinal = -200;

	constructor(
		@IDebugService private readonly debugService: IDebugService,
	) { }

	isEnabled(): boolean {
		const viewModel = this.debugService.getViewModel();
		const focusedSession = viewModel.focusedSession;
		return !!focusedSession && focusedSession.state === State.Stopped;
	}

	asPicker(_widget: IChatWidget): IChatContextPicker {
		const store = new DisposableStore();
		const mode: ISettableObservable<PickerMode> = observableValue('debugPicker.mode', PickerMode.Main);
		const query: ISettableObservable<string> = observableValue('debugPicker.query', '');

		const picksObservable = this.createPicksObservable(mode, query, store);

		return {
			placeholder: localize('selectDebugData', 'Select debug data to attach'),
			picks: (_queryObs: IObservable<string>, token: CancellationToken) => {
				store.add(autorun(reader => {
					query.set(_queryObs.read(reader), undefined);
				}));

				const cts = new CancellationTokenSource(token);
				store.add(toDisposable(() => cts.dispose(true)));

				return picksObservable;
			},
			goBack: () => {
				if (mode.get() === PickerMode.Expression) {
					mode.set(PickerMode.Main, undefined);
					return true;
				}
				return false;
			},
			dispose: () => store.dispose(),
		};
	}

	private createPicksObservable(
		mode: ISettableObservable<PickerMode>,
		query: IObservable<string>,
		store: DisposableStore
	): IObservable<{ busy: boolean; picks: ChatContextPick[] }> {
		const debouncedQuery = debouncedObservable(query, 300);

		return derived(reader => {
			const currentMode = mode.read(reader);

			if (currentMode === PickerMode.Expression) {
				return this.getExpressionPicks(debouncedQuery, store);
			} else {
				return this.getMainPicks(mode);
			}
		}).flatten();
	}

	private getMainPicks(mode: ISettableObservable<PickerMode>): IObservable<{ busy: boolean; picks: ChatContextPick[] }> {
		const promise = derived(_reader => {
			return new ObservablePromise(this.buildMainPicks(mode));
		});

		return promise.map((value, reader) => {
			const result = value.promiseResult.read(reader);
			return { picks: result?.data || [], busy: result === undefined };
		});
	}

	private async buildMainPicks(mode: ISettableObservable<PickerMode>): Promise<ChatContextPick[]> {
		const picks: ChatContextPick[] = [];
		const viewModel = this.debugService.getViewModel();
		const stackFrame = viewModel.focusedStackFrame;
		const session = viewModel.focusedSession;

		if (!session || !stackFrame) {
			return picks;
		}

		picks.push({
			label: localize('expressionValue', 'Expression Value...'),
			iconClass: ThemeIcon.asClassName(Codicon.symbolVariable),
			asAttachment: () => {
				mode.set(PickerMode.Expression, undefined);
				return 'noop';
			},
		});

		const watches = this.debugService.getModel().getWatchExpressions();
		if (watches.length > 0) {
			picks.push({ type: 'separator', label: localize('watchExpressions', 'Watch Expressions') });
			for (const watch of watches) {
				picks.push({
					label: watch.name,
					description: watch.value,
					iconClass: ThemeIcon.asClassName(Codicon.eye),
					asAttachment: (): IChatRequestVariableEntry[] => createDebugAttachments(stackFrame, createDebugVariableEntry(watch)),
				});
			}
		}

		let scopes: IScope[] = [];
		try {
			scopes = await stackFrame.getScopes();
		} catch {
		}

		for (const scope of scopes) {
			if (scope.expensive && !scope.childrenHaveBeenLoaded) {
				continue;
			}

			picks.push({ type: 'separator', label: scope.name });
			try {
				const variables = await scope.getChildren();
				if (variables.length > 1) {
					picks.push({
						label: localize('allVariablesInScope', 'All variables in {0}', scope.name),
						iconClass: ThemeIcon.asClassName(Codicon.symbolNamespace),
						asAttachment: (): IChatRequestVariableEntry[] => createDebugAttachments(stackFrame, createScopeEntry(scope, variables)),
					});
				}
				for (const variable of variables) {
					picks.push({
						label: variable.name,
						description: formatVariableDescription(variable),
						iconClass: ThemeIcon.asClassName(Codicon.symbolVariable),
						asAttachment: (): IChatRequestVariableEntry[] => createDebugAttachments(stackFrame, createDebugVariableEntry(variable)),
					});
				}
			} catch {
			}
		}

		return picks;
	}

	private getExpressionPicks(
		query: IObservable<string>,
		_store: DisposableStore
	): IObservable<{ busy: boolean; picks: ChatContextPick[] }> {
		const promise = derived((reader) => {
			const queryValue = query.read(reader);
			const cts = new CancellationTokenSource();
			reader.store.add(toDisposable(() => cts.dispose(true)));
			return new ObservablePromise(this.evaluateExpression(queryValue, cts.token));
		});

		return promise.map((value, r) => {
			const result = value.promiseResult.read(r);
			return { picks: result?.data || [], busy: result === undefined };
		});
	}

	private async evaluateExpression(expression: string, token: CancellationToken): Promise<ChatContextPick[]> {
		if (!expression.trim()) {
			return [{
				label: localize('typeExpression', 'Type an expression to evaluate...'),
				disabled: true,
				asAttachment: () => 'noop',
			}];
		}

		const viewModel = this.debugService.getViewModel();
		const session = viewModel.focusedSession;
		const stackFrame = viewModel.focusedStackFrame;

		if (!session || !stackFrame) {
			return [{
				label: localize('noDebugSession', 'No active debug session'),
				disabled: true,
				asAttachment: () => 'noop',
			}];
		}

		try {
			const response = await session.evaluate(expression, stackFrame.frameId, 'watch');

			if (token.isCancellationRequested) {
				return [];
			}

			if (response?.body) {
				const resultValue = response.body.result;
				const resultType = response.body.type;
				return [{
					label: expression,
					description: formatExpressionResult(resultValue, resultType),
					iconClass: ThemeIcon.asClassName(Codicon.symbolVariable),
					asAttachment: (): IChatRequestVariableEntry[] => createDebugAttachments(stackFrame, {
						kind: 'debugVariable',
						id: `debug-expression:${expression}`,
						name: expression,
						fullName: expression,
						icon: Codicon.debug,
						value: resultValue,
						expression: expression,
						type: resultType,
						modelDescription: formatModelDescription(expression, resultValue, resultType),
					}),
				}];
			} else {
				return [{
					label: expression,
					description: localize('noResult', 'No result'),
					disabled: true,
					asAttachment: () => 'noop',
				}];
			}
		} catch (err) {
			return [{
				label: expression,
				description: err instanceof Error ? err.message : localize('evaluationError', 'Evaluation error'),
				disabled: true,
				asAttachment: () => 'noop',
			}];
		}
	}
}

function createDebugVariableEntry(expression: IExpression): IDebugVariableEntry {
	return {
		kind: 'debugVariable',
		id: `debug-variable:${expression.getId()}`,
		name: expression.name,
		fullName: expression.name,
		icon: Codicon.debug,
		value: expression.value,
		expression: expression.name,
		type: expression.type,
		modelDescription: formatModelDescription(expression.name, expression.value, expression.type),
	};
}

function createPausedLocationEntry(stackFrame: IStackFrame): IChatRequestFileEntry {
	const uri = stackFrame.source.uri;
	let range = Range.lift(stackFrame.range);
	if (range.isEmpty()) {
		range = range.setEndPosition(range.startLineNumber + 1, 1);
	}

	return {
		kind: 'file',
		value: { uri, range },
		id: `debug-paused-location:${uri.toString()}:${range.startLineNumber}`,
		name: basename(uri),
		modelDescription: 'The debugger is currently paused at this location',
	};
}

function createDebugAttachments(stackFrame: IStackFrame, variableEntry: IDebugVariableEntry): IChatRequestVariableEntry[] {
	return [
		createPausedLocationEntry(stackFrame),
		variableEntry,
	];
}

function createScopeEntry(scope: IScope, variables: IExpression[]): IDebugVariableEntry {
	const variablesSummary = variables.map(v => `${v.name}: ${v.value}`).join('\n');
	return {
		kind: 'debugVariable',
		id: `debug-scope:${scope.name}`,
		name: `Scope: ${scope.name}`,
		fullName: `Scope: ${scope.name}`,
		icon: Codicon.debug,
		value: variablesSummary,
		expression: scope.name,
		type: 'scope',
		modelDescription: `Debug scope "${scope.name}" with ${variables.length} variables:\n${variablesSummary}`,
	};
}

function formatVariableDescription(expression: IExpression): string {
	const value = expression.value;
	const type = expression.type;
	if (type && value) {
		return `${type}: ${value}`;
	}
	return value || type || '';
}

function formatExpressionResult(value: string, type?: string): string {
	if (type && value) {
		return `${type}: ${value}`;
	}
	return value || type || '';
}

function formatModelDescription(name: string, value: string, type?: string): string {
	let description = `Debug variable "${name}"`;
	if (type) {
		description += ` of type ${type}`;
	}
	description += ` with value: ${value}`;
	return description;
}

export class DebugChatContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chat.debugChatContextContribution';

	constructor(
		@IChatContextPickService contextPickService: IChatContextPickService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(contextPickService.registerChatContextItem(instantiationService.createInstance(DebugSessionContextPick)));
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.debug.action.addVariableToChat',
			title: localize('addToChat', 'Add to Chat'),
			f1: false,
			menu: {
				id: MenuId.DebugVariablesContext,
				group: 'z_commands',
				order: 110,
				when: ChatContextKeys.enabled
			}
		});
	}

	override async run(accessor: ServicesAccessor, context: unknown): Promise<void> {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const debugService = accessor.get(IDebugService);
		const widget = await chatWidgetService.revealWidget();
		if (!widget) {
			return;
		}

		const entry = createDebugVariableEntryFromContext(context);
		if (entry) {
			const stackFrame = debugService.getViewModel().focusedStackFrame;
			if (stackFrame) {
				widget.attachmentModel.addContext(createPausedLocationEntry(stackFrame));
			}
			widget.attachmentModel.addContext(entry);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.debug.action.addWatchExpressionToChat',
			title: localize('addToChat', 'Add to Chat'),
			f1: false,
			menu: {
				id: MenuId.DebugWatchContext,
				group: 'z_commands',
				order: 110,
				when: ChatContextKeys.enabled
			}
		});
	}

	override async run(accessor: ServicesAccessor, context: IExpression): Promise<void> {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const debugService = accessor.get(IDebugService);
		const widget = await chatWidgetService.revealWidget();
		if (!context || !widget) {
			return;
		}

		const stackFrame = debugService.getViewModel().focusedStackFrame;
		if (stackFrame) {
			widget.attachmentModel.addContext(createPausedLocationEntry(stackFrame));
		}
		widget.attachmentModel.addContext(createDebugVariableEntry(context));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.debug.action.addScopeToChat',
			title: localize('addToChat', 'Add to Chat'),
			f1: false,
			menu: {
				id: MenuId.DebugScopesContext,
				group: 'z_commands',
				order: 1,
				when: ChatContextKeys.enabled
			}
		});
	}

	override async run(accessor: ServicesAccessor, context: IScopesContext): Promise<void> {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const debugService = accessor.get(IDebugService);
		const widget = await chatWidgetService.revealWidget();
		if (!context || !widget) {
			return;
		}

		const viewModel = debugService.getViewModel();
		const stackFrame = viewModel.focusedStackFrame;
		if (!stackFrame) {
			return;
		}

		try {
			const scopes = await stackFrame.getScopes();
			const scope = scopes.find(s => s.name === context.scope.name);
			if (scope) {
				const variables = await scope.getChildren();
				widget.attachmentModel.addContext(createPausedLocationEntry(stackFrame));
				widget.attachmentModel.addContext(createScopeEntry(scope, variables));
			}
		} catch {
		}
	}
});

interface IScopesContext {
	scope: { name: string };
}

interface IVariablesContext {
	sessionId: string | undefined;
	variable: { name: string; value: string; type?: string; evaluateName?: string };
}

function isVariablesContext(context: unknown): context is IVariablesContext {
	return typeof context === 'object' && context !== null && 'variable' in context && 'sessionId' in context;
}

function createDebugVariableEntryFromContext(context: unknown): IDebugVariableEntry | undefined {
	if (context instanceof Variable) {
		return createDebugVariableEntry(context);
	}

	if (isVariablesContext(context)) {
		const variable = context.variable;
		return {
			kind: 'debugVariable',
			id: `debug-variable:${variable.name}`,
			name: variable.name,
			fullName: variable.evaluateName ?? variable.name,
			icon: Codicon.debug,
			value: variable.value,
			expression: variable.evaluateName ?? variable.name,
			type: variable.type,
			modelDescription: formatModelDescription(variable.evaluateName || variable.name, variable.value, variable.type),
		};
	}

	return undefined;
}
