import { URI } from '../../../../../base/common/uri.js';
export function getTerminalOutputDirectory(cacheHome: URI): URI {
    return URI.joinPath(cacheHome, 'dardcor-terminal-output');
}
