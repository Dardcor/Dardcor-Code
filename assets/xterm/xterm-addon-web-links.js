(function webLinksUniversalModuleDefinition(root, factory) {
  if (typeof exports === 'object' && typeof module === 'object')
    module.exports = factory();
  else if (typeof define === 'function' && define.amd)
    define([], factory);
  else {
    var a = factory();
    for (var i in a) (typeof exports === 'object' ? exports : root)[i] = a[i];
  }
})(self, function () {
  'use strict';

  var URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
  var EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;

  function WebLinksAddon(handler, options) {
    this._handler = handler || function (event, uri) {
      window.open(uri, '_blank');
    };
    this._options = options || {};
  }

  WebLinksAddon.prototype.activate = function (terminal) {
    this._terminal = terminal;

    if (terminal.registerLinkProvider) {
      terminal.registerLinkProvider({
        provideLinks: function (bufferLineNumber, callback) {
          var line = terminal.buffer.active.getLine(bufferLineNumber);
          if (!line) { callback(undefined); return; }
          var lineStr = line.translateToString();
          var links = [];
          var match;

          URL_REGEX.lastIndex = 0;
          while ((match = URL_REGEX.exec(lineStr)) !== null) {
            links.push(createLink(match, bufferLineNumber));
          }

          EMAIL_REGEX.lastIndex = 0;
          while ((match = EMAIL_REGEX.exec(lineStr)) !== null) {
            links.push(createLink(match, bufferLineNumber));
          }

          callback({ links: links.length > 0 ? links : undefined });
        }
      });
    }
  };

  function createLink(match, bufferLineNumber) {
    var x1 = match.index;
    var x2 = x1 + match[0].length;
    return {
      range: {
        start: { x: x1 + 1, y: bufferLineNumber + 1 },
        end: { x: x2 + 1, y: bufferLineNumber + 1 }
      },
      text: match[0],
      activate: function (e, uri) {
        window.open(uri, '_blank');
      },
      hover: function (e, text) {
        if (window.showLinkHover) { window.showLinkHover(text); }
      },
      leave: function (e, text) {
        if (window.hideLinkHover) { window.hideLinkHover(); }
      }
    };
  }

  WebLinksAddon.prototype.dispose = function () {
    this._terminal = null;
  };

  return { WebLinksAddon: WebLinksAddon };
});
