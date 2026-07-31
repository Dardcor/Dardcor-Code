/**
 * Dardcor Code - Context Key Logical Expression Evaluator (Task 120)
 */

export type ContextKeyValue = string | boolean | number | null | undefined;

export abstract class ContextKeyExpression {
	public abstract evaluate(context: Map<string, ContextKeyValue>): boolean;
	public abstract serialize(): string;
}

export class FalseContextKeyExpression extends ContextKeyExpression {
	public evaluate(): boolean {
		return false;
	}
	public serialize(): string {
		return 'false';
	}
}

export class TrueContextKeyExpression extends ContextKeyExpression {
	public evaluate(): boolean {
		return true;
	}
	public serialize(): string {
		return 'true';
	}
}

export class KeyExpression extends ContextKeyExpression {
	constructor(public readonly key: string) {
		super();
	}

	public evaluate(context: Map<string, ContextKeyValue>): boolean {
		return !!context.get(this.key);
	}

	public serialize(): string {
		return this.key;
	}
}

export class NotExpression extends ContextKeyExpression {
	constructor(public readonly child: ContextKeyExpression) {
		super();
	}

	public evaluate(context: Map<string, ContextKeyValue>): boolean {
		return !this.child.evaluate(context);
	}

	public serialize(): string {
		return `!${this.child.serialize()}`;
	}
}

export class AndExpression extends ContextKeyExpression {
	constructor(public readonly left: ContextKeyExpression, public readonly right: ContextKeyExpression) {
		super();
	}

	public evaluate(context: Map<string, ContextKeyValue>): boolean {
		return this.left.evaluate(context) && this.right.evaluate(context);
	}

	public serialize(): string {
		return `(${this.left.serialize()} && ${this.right.serialize()})`;
	}
}

export class OrExpression extends ContextKeyExpression {
	constructor(public readonly left: ContextKeyExpression, public readonly right: ContextKeyExpression) {
		super();
	}

	public evaluate(context: Map<string, ContextKeyValue>): boolean {
		return this.left.evaluate(context) || this.right.evaluate(context);
	}

	public serialize(): string {
		return `(${this.left.serialize()} || ${this.right.serialize()})`;
	}
}

export type CompareOperator = '==' | '!=' | '>=' | '<=' | '>' | '<' | '=~' | '!~';

export class CompareExpression extends ContextKeyExpression {
	constructor(
		public readonly key: string,
		public readonly operator: CompareOperator,
		public readonly operand: string | number | boolean
	) {
		super();
	}

	public evaluate(context: Map<string, ContextKeyValue>): boolean {
		const value = context.get(this.key);
		switch (this.operator) {
			case '==': return this._equals(value, this.operand);
			case '!=': return !this._equals(value, this.operand);
			case '>=': return typeof value === 'number' && value >= (this.operand as number);
			case '<=': return typeof value === 'number' && value <= (this.operand as number);
			case '>': return typeof value === 'number' && value > (this.operand as number);
			case '<': return typeof value === 'number' && value < (this.operand as number);
			case '=~': return this._regexMatch(value, this.operand, false);
			case '!~': return this._regexMatch(value, this.operand, true);
		}
	}

	public serialize(): string {
		const operand = typeof this.operand === 'string' ? `'${this.operand}'` : String(this.operand);
		return `${this.key} ${this.operator} ${operand}`;
	}

	private _equals(value: ContextKeyValue, operand: string | number | boolean): boolean {
		if (typeof operand === 'boolean') {
			return !!value === operand;
		}
		if (typeof operand === 'number') {
			return typeof value === 'number' && value === operand;
		}
		return String(value) === operand;
	}

	private _regexMatch(value: ContextKeyValue, pattern: string | number | boolean, negate: boolean): boolean {
		try {
			const regex = new RegExp(String(pattern));
			const matched = regex.test(String(value ?? ''));
			return negate ? !matched : matched;
		} catch {
			return false;
		}
	}
}

export namespace ContextKeyExpr {
	export const False = new FalseContextKeyExpression();
	export const True = new TrueContextKeyExpression();

	export function has(key: string): ContextKeyExpression {
		return new KeyExpression(key);
	}

	export function not(key: string): ContextKeyExpression {
		return new NotExpression(has(key));
	}

	export function parse(text: string): ContextKeyExpression | null {
		return ContextKeyExpressionParser.parse(text);
	}
}

type Token =
	| { type: 'ident'; value: string }
	| { type: 'string'; value: string }
	| { type: 'number'; value: number }
	| { type: 'regex'; value: string }
	| { type: 'op'; value: '&&' | '||' | '!' | '(' | ')' | '==' | '!=' | '>=' | '<=' | '>' | '<' | '=~' | '!~' }
	| { type: 'eof'; value?: undefined };


function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (ch === ' ' || ch === '\t' || ch === '\n') {
			i++;
			continue;
		}
		if (ch === '(') { tokens.push({ type: 'op', value: '(' }); i++; continue; }
		if (ch === ')') { tokens.push({ type: 'op', value: ')' }); i++; continue; }
		if (ch === '!') {
			if (input[i + 1] === '~') { tokens.push({ type: 'op', value: '!~' }); i += 2; continue; }
			if (input[i + 1] === '=') { tokens.push({ type: 'op', value: '!=' }); i += 2; continue; }
			tokens.push({ type: 'op', value: '!' }); i++; continue;
		}
		if (ch === '&' && input[i + 1] === '&') { tokens.push({ type: 'op', value: '&&' }); i += 2; continue; }
		if (ch === '|' && input[i + 1] === '|') { tokens.push({ type: 'op', value: '||' }); i += 2; continue; }
		if (ch === '=') {
			if (input[i + 1] === '=') { tokens.push({ type: 'op', value: '==' }); i += 2; continue; }
			if (input[i + 1] === '~') { tokens.push({ type: 'op', value: '=~' }); i += 2; continue; }
			tokens.push({ type: 'op', value: '==' }); i++; continue;
		}
		if (ch === '>') {
			if (input[i + 1] === '=') { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
			tokens.push({ type: 'op', value: '>' }); i++; continue;
		}
		if (ch === '<') {
			if (input[i + 1] === '=') { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }
			tokens.push({ type: 'op', value: '<' }); i++; continue;
		}
		if (ch === "'" || ch === '"') {
			const quote = ch;
			let j = i + 1;
			let value = '';
			while (j < input.length && input[j] !== quote) {
				if (input[j] === '\\' && j + 1 < input.length) {
					value += input[j + 1];
					j += 2;
					continue;
				}
				value += input[j];
				j++;
			}
			tokens.push({ type: 'string', value });
			i = j + 1;
			continue;
		}
		if (ch === '/') {
			let j = i + 1;
			let value = '';
			while (j < input.length && input[j] !== '/') {
				value += input[j];
				j++;
			}
			tokens.push({ type: 'regex', value });
			i = j + 1;
			continue;
		}
		if (/[0-9]/.test(ch)) {
			let j = i;
			while (j < input.length && /[0-9.\-]/.test(input[j])) j++;
			tokens.push({ type: 'number', value: parseFloat(input.substring(i, j)) });
			i = j;
			continue;
		}
		if (/[a-zA-Z_.]/.test(ch)) {
			let j = i;
			while (j < input.length && /[a-zA-Z0-9_.\-:]/.test(input[j])) j++;
			tokens.push({ type: 'ident', value: input.substring(i, j) });
			i = j;
			continue;
		}
		i++;
	}
	tokens.push({ type: 'eof' });
	return tokens;
}

export class ContextKeyExpressionParser {
	public static parse(text: string): ContextKeyExpression | null {
		if (!text || !text.trim()) {
			return ContextKeyExpr.True;
		}
		try {
			const tokens = tokenize(text);
			return parseOr(tokens, { current: 0 });
		} catch {
			return null;
		}
	}
}

function isOpToken(token: Token | undefined, op: string): boolean {
	return token !== undefined && 'value' in token && token.value === op;
}


function parseOr(tokens: Token[], indexRef: { current: number }): ContextKeyExpression {
	let left = parseAnd(tokens, indexRef);
	while (isOpToken(peek(tokens, indexRef.current), '||')) {
		indexRef.current++;
		const right = parseAnd(tokens, indexRef);
		left = new OrExpression(left, right);
	}
	return left;
}

function parseAnd(tokens: Token[], indexRef: { current: number }): ContextKeyExpression {
	let left = parseUnary(tokens, indexRef);
	while (isOpToken(peek(tokens, indexRef.current), '&&')) {
		indexRef.current++;
		const right = parseUnary(tokens, indexRef);
		left = new AndExpression(left, right);
	}
	return left;
}

function parseUnary(tokens: Token[], indexRef: { current: number }): ContextKeyExpression {
	const token = peek(tokens, indexRef.current);
	if (!token || token.type === 'eof') {
		return ContextKeyExpr.True;
	}
	if (token.type === 'op' && token.value === '!') {
		indexRef.current++;
		return new NotExpression(parseUnary(tokens, indexRef));
	}
	if (token.type === 'op' && token.value === '(') {
		indexRef.current++;
		const expr = parseOr(tokens, indexRef);
		const close = peek(tokens, indexRef.current);
		if (close?.type === 'op' && close.value === ')') {
			indexRef.current++;
		}
		return expr;
	}
	return parseComparison(tokens, indexRef);
}

function parseComparison(tokens: Token[], indexRef: { current: number }): ContextKeyExpression {
	const keyToken = peek(tokens, indexRef.current);
	if (!keyToken || keyToken.type !== 'ident') {
		indexRef.current++;
		return ContextKeyExpr.True;
	}
	indexRef.current++;
	const opToken = peek(tokens, indexRef.current);
	if (opToken && opToken.type === 'op' && (opToken.value === '==' || opToken.value === '!=' || opToken.value === '>=' || opToken.value === '<=' || opToken.value === '>' || opToken.value === '<' || opToken.value === '=~' || opToken.value === '!~')) {
		indexRef.current++;
		const operandToken = peek(tokens, indexRef.current);
		if (!operandToken || operandToken.type === 'eof') {
			return ContextKeyExpr.has(keyToken.value);
		}
		indexRef.current++;
		if (operandToken.type === 'string' || operandToken.type === 'regex') {
			return new CompareExpression(keyToken.value, opToken.value as CompareOperator, operandToken.value);
		}
		if (operandToken.type === 'number') {
			return new CompareExpression(keyToken.value, opToken.value as CompareOperator, operandToken.value);
		}
		if (operandToken.type === 'ident') {
			if (operandToken.value === 'true') return new CompareExpression(keyToken.value, opToken.value as CompareOperator, true);
			if (operandToken.value === 'false') return new CompareExpression(keyToken.value, opToken.value as CompareOperator, false);
			return new CompareExpression(keyToken.value, opToken.value as CompareOperator, operandToken.value);
		}
		return ContextKeyExpr.has(keyToken.value);
	}
	return ContextKeyExpr.has(keyToken.value);
}

function peek(tokens: Token[], index: number): Token | undefined {
	return tokens[index];
}

export function evaluateContextExpression(expression: string, context: Map<string, ContextKeyValue>): boolean {
	const expr = ContextKeyExpressionParser.parse(expression);
	if (!expr) {
		return true;
	}
	return expr.evaluate(context);
}
