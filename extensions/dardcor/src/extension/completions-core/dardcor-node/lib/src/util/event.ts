/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../types/src';
import * as lsp from 'vscode-languageserver-protocol';

export interface Event<T> {
	(listener: (e: T) => void, thisArgs?: unknown, disposables?: Disposable[]): Disposable;
}

export class Emitter<T> extends lsp.Emitter<T> {
	override get event(): Event<T> {
		return super.event;
	}
}

export function transformEvent<T, R extends object>(event: Event<T>, transform: (value: T) => R | undefined): Event<R> {
	return (listener, thisArgs, disposables) => {
		if (thisArgs) { listener = listener.bind(thisArgs); }
		const wrappedListener = (value: T) => {
			const transformed = transform(value);
			if (transformed !== undefined) { listener(transformed); }
		};
		return event(wrappedListener, undefined, disposables);
	};
}
