/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Define TextEncoder + TextDecoder globals for both browser and node runtimes

declare var TextDecoder: typeof import('util').TextDecoder;
declare var TextEncoder: typeof import('util').TextEncoder;
