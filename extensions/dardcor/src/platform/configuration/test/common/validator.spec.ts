/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { vBoolean, vNumber, vObj, vRequired, vString } from '../../common/validator';

describe('vRequired', () => {
	it('should mark a field as required', () => {
		const validator = vObj({
			name: vRequired(vString()),
			age: vNumber(),
		});

		const result1 = validator.validate({ age: 25 });
		expect(result1.error).toBeDefined();
		expect(result1.error?.message).toContain(`Required field 'name' is missing`);

		const result2 = validator.validate({ name: 'John', age: 25 });
		expect(result2.error).toBeUndefined();
		expect(result2.content).toEqual({ name: 'John', age: 25 });
	});

	it('should allow optional fields to be missing', () => {
		const validator = vObj({
			name: vRequired(vString()),
			age: vNumber(),
			city: vString(),
		});

		const result = validator.validate({ name: 'John' });
		expect(result.error).toBeUndefined();
		expect(result.content).toEqual({ name: 'John' });
	});

	it('should validate the value when required field is provided', () => {
		const validator = vObj({
			name: vRequired(vString()),
		});

		const result = validator.validate({ name: 123 });
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain('Expected string');
	});

	it('should handle multiple required fields', () => {
		const validator = vObj({
			firstName: vRequired(vString()),
			lastName: vRequired(vString()),
			age: vNumber(),
		});

		const result1 = validator.validate({ firstName: 'John' });
		expect(result1.error).toBeDefined();
		expect(result1.error?.message).toContain(`Required field 'lastName' is missing`);

		const result2 = validator.validate({ firstName: 'John', lastName: 'Doe' });
		expect(result2.error).toBeUndefined();
		expect(result2.content).toEqual({ firstName: 'John', lastName: 'Doe' });

		const result3 = validator.validate({ firstName: 'John', lastName: 'Doe', age: 30 });
		expect(result3.error).toBeUndefined();
		expect(result3.content).toEqual({ firstName: 'John', lastName: 'Doe', age: 30 });
	});

	it('should generate correct JSON schema with required fields', () => {
		const validator = vObj({
			name: vRequired(vString()),
			age: vNumber(),
			isActive: vRequired(vBoolean()),
		});

		const schema = validator.toSchema();
		expect(schema).toEqual({
			type: 'object',
			properties: {
				name: { type: 'string' },
				age: { type: 'number' },
				isActive: { type: 'boolean' },
			},
			required: ['name', 'isActive'],
		});
	});

	it('should generate JSON schema without required array when no fields are required', () => {
		const validator = vObj({
			name: vString(),
			age: vNumber(),
		});

		const schema = validator.toSchema();
		expect(schema).toEqual({
			type: 'object',
			properties: {
				name: { type: 'string' },
				age: { type: 'number' },
			},
		});
		expect((schema as any).required).toBeUndefined();
	});

	it('should handle nested objects with required fields', () => {
		const validator = vObj({
			user: vRequired(vObj({
				name: vRequired(vString()),
				email: vString(),
			})),
			metadata: vObj({
				created: vString(),
			}),
		});

		const result1 = validator.validate({});
		expect(result1.error).toBeDefined();
		expect(result1.error?.message).toContain(`Required field 'user' is missing`);

		const result2 = validator.validate({ user: {} });
		expect(result2.error).toBeDefined();
		expect(result2.error?.message).toContain(`Required field 'name' is missing`);

		const result3 = validator.validate({ user: { name: 'John' } });
		expect(result3.error).toBeUndefined();
		expect(result3.content).toEqual({ user: { name: 'John' } });
	});

	it('should handle explicit undefined for required fields', () => {
		const validator = vObj({
			name: vRequired(vString()),
		});

		const result = validator.validate({ name: undefined });
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain(`Required field 'name' is missing`);
	});

	it('should allow null for optional fields but not required fields', () => {
		const validator = vObj({
			requiredField: vRequired(vString()),
			optionalField: vString(),
		});

		const result1 = validator.validate({ requiredField: null });
		expect(result1.error).toBeDefined();

		const result2 = validator.validate({ requiredField: 'test', optionalField: null });
		expect(result2.error).toBeDefined();
	});
});
