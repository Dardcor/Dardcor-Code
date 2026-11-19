enum MyEnum {

	One,
	Two,

	Three
}

class Base {
	public foo() { }
}

class Derived extends Base {

	bar() { }


	baz() { }


	faz() { }
}

namespace MyNamespace {
	function foo() { }

	function

		bar() { }

	function

		baz() { }
}

function main() {
	const

		x = 10;

	const

		z = 20;
}

type MyType = {
}


type TypeOne = {
}


type TypeTwo = {
}

export type EndOfLife = {
	skuPlan: string | undefined;

	skuPlan: string | undefined;

	sig(value: string): void;

	sign(value: number): void;

	mark(value: number): void;

	mark(value: number): void;
}

export interface I2 {
	skuPlan: string | undefined;

	skuPlan: string | undefined;

	sig(value: string): void;

	sign(value: number): void;

	mark(value: number): void;

	mark(value: number): void;
}

export class C1 {
	skuPlan: string | undefined;

	skuPlan: string | undefined;

	foo(number: number): string;
	foo(string: string): string;

	foo(param: number | string): string {
		return param.toString();
	}

	bar(number: number): string;
	bar(number: number): string;

	bar(param: number | string): string {
		return param.toString();
	}

	bazz(number: number): string;
	bazz(string: string): string;
	bazz(param: number | string): string {
		return param.toString();
	}

	bazz(param: Function): string {
		return param.toString();
	}
}

export namespace N1 {
	function foo(param: number): string;
	function foo(param: string): string;

	function foo(param: number | string): string {
		return param.toString();
	}

	function bar(param: number): string;
	function bar(param: number): string;

	function bar(param: number | string): string {
		return param.toString();
	}

	function bazz(param: number): string;
	function bazz(param: string): string;
	function bazz(param: number | string): string {
		return param.toString();
	}

	function bazz(param: Function): string {
		return param.toString();
	}
}

export function sameName(): void {
}

export namespace N2 {
	function foo(): void {
	}

	function bar(): void {
	}


	function baz(): void {
	}
}

export function myFunc(): void {
	function foo(): void {
	}

	function bar(): void {
	}


	function baz(): void {
	}
}

export function redeclaredVariable(): void {
	const minimalIconWidth = 16;

	const minimalIconWidth = minimalIconWidth + 2;
}

export function redeclaredVariableFunctionScoped(minimalIconWidth = 16): void {

	const minimalIconWidth = minimalIconWidth + 2;
}
