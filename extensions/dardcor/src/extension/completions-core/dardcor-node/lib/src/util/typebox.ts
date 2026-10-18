/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const assertShape = <S extends TSchema>(schema: S, payload: unknown): Static<S> => {
	if (Value.Check(schema, payload)) { return payload; }

	const error = `Typebox schema validation failed:\n${[...Value.Errors(schema, payload)]
		.map(i => `${i.path} ${i.message}`)
		.join('\n')}`;

	throw new Error(error);
};
