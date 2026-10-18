/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export declare const REPO_ROOT: string;

export declare const OUT_DIR: string;

export declare const VERSION_FILE: string;

export declare function resolveCodexBinary(): string;

export declare function readBinaryVersion(bin: string): string;

export declare function readPinnedVersion(): string;

export declare function generate(bin: string, outDir: string, codexVersion: string): void;
