/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertDefined } from '../types.js';
import { Disposable, DisposableMap } from '../lifecycle.js';
import { CancellationTokenSource, CancellationToken } from '../cancellation.js';

type TWithOptionalCancellationToken<TFunction extends Function> = TFunction extends (...args: infer TArgs) => infer TReturn
	? (...args: [...TArgs, cancellatioNToken?: CancellationToken]) => TReturn
	: never;

export function cancelPreviousCalls<
	TObject extends Disposable,
	TArgs extends unknown[],
	TReturn,
>(
	_proto: TObject,
	methodName: string,
	descriptor: TypedPropertyDescriptor<TWithOptionalCancellationToken<(...args: TArgs) => TReturn>>,
) {
	const originalMethod = descriptor.value;

	assertDefined(
		originalMethod,
		`Method '${methodName}' is not defined.`,
	);


	const objectRecords = new WeakMap<TObject, DisposableMap<string, CancellationTokenSource>>();

	descriptor.value = function (
		this: TObject,
		...args: Parameters<typeof originalMethod>
	): TReturn {
		let record = objectRecords.get(this);
		if (!record) {
			record = new DisposableMap();
			objectRecords.set(this, record);

			this._register({
				dispose: () => {
					objectRecords.get(this)?.dispose();
					objectRecords.delete(this);
				},
			});
		}

		record.get(methodName)?.dispose(true);


		const lastArgument = (args.length > 0)
			? args[args.length - 1]
			: undefined;
		const token = CancellationToken.isCancellationToken(lastArgument)
			? lastArgument
			: undefined;

		const cancellationSource = new CancellationTokenSource(token);
		record.set(methodName, cancellationSource);

		if (CancellationToken.isCancellationToken(lastArgument)) {
			args[args.length - 1] = cancellationSource.token;
		} else {
			args.push(cancellationSource.token);
		}

		return originalMethod.call(this, ...args);
	};

	return descriptor;
}
