/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/



export function fib(n) {
    if (n < 2) {
        return n
    }
    return fib(n - 1) + fib(n - 2)
}