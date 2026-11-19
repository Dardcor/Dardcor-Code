/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export { observableValueOpts } from './observables/observableValueOpts';
export { autorun, autorunDelta, autorunHandleChanges, autorunOpts, autorunWithStore, autorunWithStoreHandleChanges, autorunIterableDelta, autorunPerKeyedItem, autorunSelfDisposable, registerAutorunSelfDisposable } from './reactions/autorun';
export { type IObservable, type IObservableWithChange, type IObserver, type IReader, type ISettable, type IReaderWithStore, type ISettableObservable, type ITransaction } from './base';
export { disposableObservableValue } from './observables/observableValue';
export { derived, derivedDisposable, derivedHandleChanges, derivedOpts, derivedWithSetter, derivedWithStore } from './observables/derived';
export { type IDerivedReader } from './observables/derivedImpl';
export { ObservableLazy, ObservableLazyPromise, ObservablePromise, ObservableResolvedPromise, PromiseResult, } from './utils/promise';
export { derivedWithCancellationToken, waitForState } from './utils/utilsCancellation';
export {
	debouncedObservable, debouncedObservable2, derivedObservableWithCache,
	derivedObservableWithWritableCache, keepObserved, mapObservableArrayCached, observableFromPromise,
	recomputeInitiallyAndOnChange,
	signalFromObservable, throttledObservable, wasEventTriggeredRecently,
	isObservable,
} from './utils/utils';
export { type DebugOwner } from './debugName';
export { type IChangeContext, type IChangeTracker, recordChanges, recordChangesLazy } from './changeTracker';
export { constObservable } from './observables/constObservable';
export { type IObservableSignal, observableSignal } from './observables/observableSignal';
export { observableFromEventOpts } from './observables/observableFromEvent';
export { observableSignalFromEvent } from './observables/observableSignalFromEvent';
export { asyncTransaction, globalTransaction, subtransaction, transaction, TransactionImpl } from './transaction';
export { observableFromValueWithChangeEvent, ValueWithChangeEventFromObservable } from './utils/valueWithChangeEvent';
export { runOnChange, runOnChangeWithCancellationToken, runOnChangeWithStore, type RemoveUndefined } from './utils/runOnChange';
export { derivedConstOnceDefined, latestChangedValue } from './experimental/utils';
export { observableFromEvent } from './observables/observableFromEvent';
export { observableValue } from './observables/observableValue';

export { ObservableSet } from './set';
export { ObservableMap } from './map';
export { DebugLocation } from './debugLocation';

import { addLogger, setLogObservableFn } from './logging/logging';
import { ConsoleObservableLogger, logObservableToConsole } from './logging/consoleObservableLogger';
import { DevToolsLogger } from './logging/debugger/devToolsLogger';
import { env } from '../process';
import { _setDebugGetObservableGraph } from './observables/baseObservable';
import { debugGetObservableGraph } from './logging/debugGetDependencyGraph';

_setDebugGetObservableGraph(debugGetObservableGraph);
setLogObservableFn(logObservableToConsole);

const enableLogging = false
	;

if (enableLogging) {
	addLogger(new ConsoleObservableLogger());
}

if (env && env['VSCODE_DEV_DEBUG_OBSERVABLES']) {
	addLogger(DevToolsLogger.getInstance());
}
