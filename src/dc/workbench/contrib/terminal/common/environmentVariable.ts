/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { EnvironmentVariableScope, IEnvironmentVariableCollection, IMergedEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariable.js';
import { ITerminalStatus } from './terminal.js';

export const IEnvironmentVariableService = createDecorator<IEnvironmentVariableService>('environmentVariableService');

export interface IEnvironmentVariableService {
	readonly _serviceBrand: undefined;

	readonly collections: ReadonlyMap<string, IEnvironmentVariableCollection>;

	readonly mergedCollection: IMergedEnvironmentVariableCollection;

	readonly onDidChangeCollections: Event<IMergedEnvironmentVariableCollection>;

	set(extensionIdentifier: string, collection: IEnvironmentVariableCollection): void;

	delete(extensionIdentifier: string): void;
}

export interface IEnvironmentVariableCollectionWithPersistence extends IEnvironmentVariableCollection {
	readonly persistent: boolean;
}

export interface IEnvironmentVariableInfo {
	readonly requiresAction: boolean;
	getStatus(scope: EnvironmentVariableScope | undefined): ITerminalStatus;
}
