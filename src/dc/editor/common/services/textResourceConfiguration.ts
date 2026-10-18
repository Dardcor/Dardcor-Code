/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { IPosition } from '../core/position.js';
import { ConfigurationTarget, IConfigurationValue } from '../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const ITextResourceConfigurationService = createDecorator<ITextResourceConfigurationService>('textResourceConfigurationService');

export interface ITextResourceConfigurationChangeEvent {

	readonly affectedKeys: ReadonlySet<string>;

	affectsConfiguration(resource: URI | undefined, section: string): boolean;
}

export interface ITextResourceConfigurationService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeConfiguration: Event<ITextResourceConfigurationChangeEvent>;

	getValue<T>(resource: URI | undefined, section?: string): T;
	getValue<T>(resource: URI | undefined, position?: IPosition, section?: string): T;

	inspect<T>(resource: URI | undefined, position: IPosition | null, section: string): IConfigurationValue<Readonly<T>>;

	updateValue(resource: URI | undefined, key: string, value: unknown, configurationTarget?: ConfigurationTarget): Promise<void>;

}

export const ITextResourcePropertiesService = createDecorator<ITextResourcePropertiesService>('textResourcePropertiesService');

export interface ITextResourcePropertiesService {

	readonly _serviceBrand: undefined;

	getEOL(resource: URI, language?: string): string;
}
