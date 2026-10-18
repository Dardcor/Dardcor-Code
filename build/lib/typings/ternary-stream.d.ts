declare module 'ternary-stream' {
	import File = require('vinyl');
	function f(check: (f: File) => boolean, onTrue: NodeJS.ReadWriteStream, opnFalse?: NodeJS.ReadWriteStream): NodeJS.ReadWriteStream;

	namespace f {}

	export = f;
}
