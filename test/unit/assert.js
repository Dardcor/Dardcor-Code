/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



const create = Object.create || function (p) {
	if (!p) { throw Error('no type'); }
	function f() { }
	f.prototype = p;
	return new f();
  };

  var util = {
	inherits: function (ctor, superCtor) {
	  ctor.super_ = superCtor;
	  ctor.prototype = create(superCtor.prototype, {
		constructor: {
		  value: ctor,
		  enumerable: false,
		  writable: true,
		  configurable: true
		}
	  });
	},
	isArray: function (ar) {
	  return Array.isArray(ar);
	},
	isBoolean: function (arg) {
	  return typeof arg === 'boolean';
	},
	isNull: function (arg) {
	  return arg === null;
	},
	isNullOrUndefined: function (arg) {
	  return arg == null;
	},
	isNumber: function (arg) {
	  return typeof arg === 'number';
	},
	isString: function (arg) {
	  return typeof arg === 'string';
	},
	isSymbol: function (arg) {
	  return typeof arg === 'symbol';
	},
	isUndefined: function (arg) {
	  return arg === undefined;
	},
	isRegExp: function (re) {
	  return util.isObject(re) && util.objectToString(re) === '[object RegExp]';
	},
	isObject: function (arg) {
	  return typeof arg === 'object' && arg !== null;
	},
	isDate: function (d) {
	  return util.isObject(d) && util.objectToString(d) === '[object Date]';
	},
	isError: function (e) {
	  return isObject(e) &&
		(objectToString(e) === '[object Error]' || e instanceof Error);
	},
	isFunction: function (arg) {
	  return typeof arg === 'function';
	},
	isPrimitive: function (arg) {
	  return arg === null ||
		typeof arg === 'boolean' ||
		typeof arg === 'number' ||
		typeof arg === 'string' ||
		typeof arg === 'symbol' ||
		typeof arg === 'undefined';
	},
	objectToString: function (o) {
	  return Object.prototype.toString.call(o);
	}
  };

  const pSlice = Array.prototype.slice;

  const Object_keys = typeof Object.keys === 'function' ? Object.keys : (function () {
	const hasOwnProperty = Object.prototype.hasOwnProperty,
	  hasDontEnumBug = !({ toString: null }).propertyIsEnumerable('toString'),
	  dontEnums = [
		'toString',
		'toLocaleString',
		'valueOf',
		'hasOwnProperty',
		'isPrototypeOf',
		'propertyIsEnumerable',
		'constructor'
	  ],
	  dontEnumsLength = dontEnums.length;

	return function (obj) {
	  if (typeof obj !== 'object' && (typeof obj !== 'function' || obj === null)) {
		throw new TypeError('Object.keys called on non-object');
	  }

	  let result = [], prop, i;

	  for (prop in obj) {
		if (hasOwnProperty.call(obj, prop)) {
		  result.push(prop);
		}
	  }

	  if (hasDontEnumBug) {
		for (i = 0; i < dontEnumsLength; i++) {
		  if (hasOwnProperty.call(obj, dontEnums[i])) {
			result.push(dontEnums[i]);
		  }
		}
	  }
	  return result;
	};
  })();


  const assert = ok;


  assert.AssertionError = function AssertionError(options) {
	this.name = 'AssertionError';
	this.actual = options.actual;
	this.expected = options.expected;
	this.operator = options.operator;
	if (options.message) {
	  this.message = options.message;
	  this.generatedMessage = false;
	} else {
	  this.message = getMessage(this);
	  this.generatedMessage = true;
	}
	const stackStartFunction = options.stackStartFunction || fail;
	if (Error.captureStackTrace) {
	  Error.captureStackTrace(this, stackStartFunction);
	} else {
	  try {
		this.stack = (new Error).stack.toString();
	  } catch (e) { }
	}
  };

  util.inherits(assert.AssertionError, Error);

  function replacer(key, value) {
	if (util.isUndefined(value)) {
	  return '' + value;
	}
	if (util.isNumber(value) && (isNaN(value) || !isFinite(value))) {
	  return value.toString();
	}
	if (util.isFunction(value) || util.isRegExp(value)) {
	  return value.toString();
	}
	return value;
  }

  function truncate(s, n) {
	if (util.isString(s)) {
	  return s.length < n ? s : s.slice(0, n);
	} else {
	  return s;
	}
  }

  function getMessage(self) {
	return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
	  self.operator + ' ' +
	  truncate(JSON.stringify(self.expected, replacer), 128);
  }



  export function fail(actual, expected, message, operator, stackStartFunction) {
	throw new assert.AssertionError({
	  message: message,
	  actual: actual,
	  expected: expected,
	  operator: operator,
	  stackStartFunction: stackStartFunction
	});
  }

  assert.fail = fail;


  export function ok(value, message) {
	if (!value) { fail(value, true, message, '==', assert.ok); }
  }
  assert.ok = ok;


  assert.equal = function equal(actual, expected, message) {
	if (actual != expected) { fail(actual, expected, message, '==', assert.equal); }
  };


  assert.notEqual = function notEqual(actual, expected, message) {
	if (actual == expected) {
	  fail(actual, expected, message, '!=', assert.notEqual);
	}
  };


  assert.deepEqual = function deepEqual(actual, expected, message) {
	if (!_deepEqual(actual, expected, false)) {
	  fail(actual, expected, message, 'deepEqual', assert.deepEqual);
	}
  };

  assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
	if (!_deepEqual(actual, expected, true)) {
	  fail(actual, expected, message, 'deepStrictEqual', assert.deepStrictEqual);
	}
  };

  function _deepEqual(actual, expected, strict) {
	if (actual === expected) {
	  return true;

	} else if (util.isDate(actual) && util.isDate(expected)) {
	  return actual.getTime() === expected.getTime();

	} else if (util.isRegExp(actual) && util.isRegExp(expected)) {
	  return actual.source === expected.source &&
		actual.global === expected.global &&
		actual.multiline === expected.multiline &&
		actual.lastIndex === expected.lastIndex &&
		actual.ignoreCase === expected.ignoreCase;

	} else if ((actual === null || typeof actual !== 'object') &&
	  (expected === null || typeof expected !== 'object')) {
	  return strict ? actual === expected : actual == expected;

	} else {
	  return objEquiv(actual, expected, strict);
	}
  }

  function isArguments(object) {
	return Object.prototype.toString.call(object) == '[object Arguments]';
  }

  function objEquiv(a, b, strict) {
	if (a === null || a === undefined || b === null || b === undefined) { return false; }
	if (util.isPrimitive(a) || util.isPrimitive(b)) { return a === b; }
	if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) { return false; }
	const aIsArgs = isArguments(a),
	  bIsArgs = isArguments(b);
	if ((aIsArgs && !bIsArgs) || (!aIsArgs && bIsArgs)) { return false; }
	if (aIsArgs) {
	  a = pSlice.call(a);
	  b = pSlice.call(b);
	  return _deepEqual(a, b, strict);
	}
	let ka = Object.keys(a),
	  kb = Object.keys(b),
	  key, i;
	if (ka.length !== kb.length) { return false; }
	ka.sort();
	kb.sort();
	for (i = ka.length - 1; i >= 0; i--) {
	  if (ka[i] !== kb[i]) { return false; }
	}
	for (i = ka.length - 1; i >= 0; i--) {
	  key = ka[i];
	  if (!_deepEqual(a[key], b[key], strict)) { return false; }
	}
	return true;
  }


  assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
	if (_deepEqual(actual, expected, false)) {
	  fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
	}
  };

  assert.notDeepStrictEqual = notDeepStrictEqual;
  export function notDeepStrictEqual(actual, expected, message) {
	if (_deepEqual(actual, expected, true)) {
	  fail(actual, expected, message, 'notDeepStrictEqual', notDeepStrictEqual);
	}
  }



  assert.strictEqual = function strictEqual(actual, expected, message) {
	if (actual !== expected) {
	  fail(actual, expected, message, '===', assert.strictEqual);
	}
  };


  assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
	if (actual === expected) {
	  fail(actual, expected, message, '!==', assert.notStrictEqual);
	}
  };

  function expectedException(actual, expected) {
	if (!actual || !expected) {
	  return false;
	}

	if (Object.prototype.toString.call(expected) == '[object RegExp]') {
	  return expected.test(actual);
	} else if (actual instanceof expected) {
	  return true;
	} else if (expected.call({}, actual) === true) {
	  return true;
	}

	return false;
  }

  function _throws(shouldThrow, block, expected, message) {
	let actual;

	if (typeof block !== 'function') {
	  throw new TypeError('block must be a function');
	}

	if (typeof expected === 'string') {
	  message = expected;
	  expected = null;
	}

	try {
	  block();
	} catch (e) {
	  actual = e;
	}

	message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
	  (message ? ' ' + message : '.');

	if (shouldThrow && !actual) {
	  fail(actual, expected, 'Missing expected exception' + message);
	}

	if (!shouldThrow && expectedException(actual, expected)) {
	  fail(actual, expected, 'Got unwanted exception' + message);
	}

	if ((shouldThrow && actual && expected &&
	  !expectedException(actual, expected)) || (!shouldThrow && actual)) {
	  throw actual;
	}
  }


  assert.throws = function (block, error, message) {
	_throws.apply(this, [true].concat(pSlice.call(arguments)));
  };

  assert.doesNotThrow = function (block, message) {
	_throws.apply(this, [false].concat(pSlice.call(arguments)));
  };

  assert.ifError = function (err) { if (err) { throw err; } };

  function checkIsPromise(obj) {
	return (obj !== null && typeof obj === 'object' &&
	  typeof obj.then === 'function' &&
	  typeof obj.catch === 'function');
  }

  const NO_EXCEPTION_SENTINEL = {};
  async function waitForActual(promiseFn) {
	let resultPromise;
	if (typeof promiseFn === 'function') {
	  resultPromise = promiseFn();
	  if (!checkIsPromise(resultPromise)) {
		throw new Error('ERR_INVALID_RETURN_VALUE: promiseFn did not return Promise. ' + resultPromise);
	  }
	} else if (checkIsPromise(promiseFn)) {
	  resultPromise = promiseFn;
	} else {
	  throw new Error('ERR_INVALID_ARG_TYPE: promiseFn is not Function or Promise. ' + promiseFn);
	}

	try {
	  await resultPromise;
	} catch (e) {
	  return e;
	}
	return NO_EXCEPTION_SENTINEL;
  }

  function expectsError(shouldHaveError, actual, message) {
	if (shouldHaveError && actual === NO_EXCEPTION_SENTINEL) {
	  fail(undefined, 'Error', `Missing expected rejection${message ? ': ' + message : ''}`)
	} else if (!shouldHaveError && actual !== NO_EXCEPTION_SENTINEL) {
	  fail(actual, undefined, `Got unexpected rejection (${actual.message})${message ? ': ' + message : ''}`)
	}
  }

  assert.rejects = async function rejects(promiseFn, message) {
	expectsError(true, await waitForActual(promiseFn), message);
  };

  assert.doesNotReject = async function doesNotReject(fn, message) {
	expectsError(false, await waitForActual(fn), message);
  };

	assert.match = function match(string, regexp, message) {
		if (typeof string !== 'string') {
			throw new TypeError(`The "string" argument must be of type string. Received type ${typeof string}`);
		}

		if (!(regexp instanceof RegExp)) {
			throw new TypeError(`The "regexp" argument must be an instance of RegExp. Received type ${typeof regexp}`);
		}

		if (!regexp.test(string)) {
			fail(string, regexp, message, 'match', assert.match);
		}
	};

	assert.doesNotMatch = function doesNotMatch(string, regexp, message) {
		if (typeof string !== 'string') {
			throw new TypeError(`The "string" argument must be of type string. Received type ${typeof string}`);
		}

		if (!(regexp instanceof RegExp)) {
			throw new TypeError(`The "regexp" argument must be an instance of RegExp. Received type ${typeof regexp}`);
		}

		if (regexp.test(string)) {
			fail(string, regexp, message, 'doesNotMatch', assert.doesNotMatch);
		}
	};

  export default assert;
  export const AssertionError = assert.AssertionError
  export const equal = assert.equal
  export const notEqual = assert.notEqual
  export const deepEqual = assert.deepEqual
  export const deepStrictEqual = assert.deepStrictEqual
  export const notDeepEqual = assert.notDeepEqual
  export const strictEqual = assert.strictEqual
  export const notStrictEqual = assert.notStrictEqual
  export const throws = assert.throws
  export const doesNotThrow = assert.doesNotThrow
  export const ifError = assert.ifError
  export const rejects = assert.rejects
  export const doesNotReject = assert.doesNotReject

	export const match = assert.match
	export const doesNotMatch = assert.doesNotMatch
