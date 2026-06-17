"""File Explorer - VS Code style file tree with file type icons."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem,
    QLabel, QPushButton, QHBoxLayout, QFileDialog, QMenu, QInputDialog,
    QMessageBox, QHeaderView, QStyledItemDelegate, QStyleOptionViewItem,
    QProxyStyle, QStyle,
)
from PySide6.QtCore import Signal, Qt, QSize, QPoint, QByteArray, QLocale
from PySide6.QtGui import QAction, QColor, QPainter, QPixmap, QIcon, QPen, QFont, QPolygonF, QCursor, QImage
from PySide6.QtSvg import QSvgRenderer

# Fix Qt locale float parsing bugs in QSvgRenderer (e.g. for European/Indonesian locales using comma as decimal point)
QLocale.setDefault(QLocale.c())


class TreeBranchStyle(QProxyStyle):
    """Custom style that draws VS Code-style chevron branch indicators."""

    def drawPrimitive(self, element, option, painter, widget=None):
        if element == QStyle.PE_IndicatorBranch:
            painter.save()
            painter.setRenderHint(QPainter.Antialiasing)

            rect = option.rect
            cx = rect.x() + rect.width() // 2
            cy = rect.y() + rect.height() // 2

            # VS Code style chevron (lines, not solid triangle)
            pen = QPen(QColor("#858585"))
            pen.setWidth(2)
            pen.setCapStyle(Qt.RoundCap)
            pen.setJoinStyle(Qt.RoundJoin)
            painter.setPen(pen)
            painter.setBrush(Qt.NoBrush)

            if option.state & QStyle.State_Children:
                if option.state & QStyle.State_Open:
                    # v downward chevron
                    painter.drawLine(cx - 3, cy - 2, cx, cy + 2)
                    painter.drawLine(cx, cy + 2, cx + 3, cy - 2)
                else:
                    # > rightward chevron
                    painter.drawLine(cx - 2, cy - 3, cx + 2, cy)
                    painter.drawLine(cx + 2, cy, cx - 2, cy + 3)

            painter.restore()
            return

        super().drawPrimitive(element, option, painter, widget)


# VS Code Material Theme SVG Icons
SVG_FOLDER = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'''

SVG_FOLDER_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/></svg>'''

SVG_FOLDER_NODE = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/><rect x="9" y="13.2" width="9" height="3.5" fill="#FFFFFF"/><path fill="#CD3F45" transform="translate(7.5, 9) scale(0.375)" d="M4 11.3v8h6.8v1.4h5.3v-1.3H28v-8.1H4zm6.6 6.7H9.3v-3.9H8V18H5.3v-5.3h5.3V18zm6.6 0h-2.7v1.4h-2.7v-6.6h5.3c.1 1.6.1 3.4.1 5.2zm9.4 0h-1.3v-3.9H24V18h-1.4v-3.9h-1.3V18h-2.7v-5.3h8V18zm-10.7-3.9h-1.3v2.6h1.3v-2.6z"/></svg>'''

SVG_FOLDER_NODE_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/><rect x="10" y="15.2" width="9" height="3.5" fill="#FFFFFF"/><path fill="#CD3F45" transform="translate(8.5, 11) scale(0.375)" d="M4 11.3v8h6.8v1.4h5.3v-1.3H28v-8.1H4zm6.6 6.7H9.3v-3.9H8V18H5.3v-5.3h5.3V18zm6.6 0h-2.7v1.4h-2.7v-6.6h5.3c.1 1.6.1 3.4.1 5.2zm9.4 0h-1.3v-3.9H24V18h-1.4v-3.9h-1.3V18h-2.7v-5.3h8V18zm-10.7-3.9h-1.3v2.6h1.3v-2.6z"/></svg>'''

SVG_FOLDER_SRC = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/><g stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M 11 11 L 9 13 L 11 15"/><path d="M 13.5 10 L 11.5 16"/><path d="M 14 11 L 16 13 L 14 15"/></g></svg>'''

SVG_FOLDER_SRC_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/><g stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none" transform="translate(1, 2)"><path d="M 11 11 L 9 13 L 11 15"/><path d="M 13.5 10 L 11.5 16"/><path d="M 14 11 L 16 13 L 14 15"/></g></svg>'''

SVG_FOLDER_PUBLIC = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/><g stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12.5" cy="13.5" r="3.5" stroke-width="1.2"/><ellipse cx="12.5" cy="13.5" rx="3.5" ry="1.2" stroke-width="1"/><ellipse cx="12.5" cy="13.5" rx="1.2" ry="3.5" stroke-width="1"/><line x1="9" y1="13.5" x2="16" y2="13.5" stroke-width="1"/><line x1="12.5" y1="10" x2="12.5" y2="17" stroke-width="1"/></g></svg>'''

SVG_FOLDER_PUBLIC_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/><g stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round" fill="none" transform="translate(1, 2)"><circle cx="12.5" cy="13.5" r="3.5" stroke-width="1.2"/><ellipse cx="12.5" cy="13.5" rx="3.5" ry="1.2" stroke-width="1"/><ellipse cx="12.5" cy="13.5" rx="1.2" ry="3.5" stroke-width="1"/><line x1="9" y1="13.5" x2="16" y2="13.5" stroke-width="1"/><line x1="12.5" y1="10" x2="12.5" y2="17" stroke-width="1"/></g></svg>'''

SVG_FOLDER_NEXT = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/><circle cx="12.5" cy="13.5" r="4.2" fill="#000000"/><path d="M10.2 16.2 L10.2 10.8 H11.2 L14.4 15.3 L14.4 10.8 H15.2 L15.2 16.2 H14.2 L11.0 11.7 L11.0 16.2 Z" fill="#FFFFFF"/></svg>'''

SVG_FOLDER_NEXT_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/><g transform="translate(1, 2)"><circle cx="12.5" cy="13.5" r="4.2" fill="#000000"/><path d="M10.2 16.2 L10.2 10.8 H11.2 L14.4 15.3 L14.4 10.8 H15.2 L15.2 16.2 H14.2 L11.0 11.7 L11.0 16.2 Z" fill="#FFFFFF"/></g></svg>'''

SVG_FOLDER_REACT = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/><g stroke="#00D8FF" stroke-width="0.8" fill="none"><ellipse cx="12.5" cy="13.5" rx="4" ry="1.4" transform="rotate(30 12.5 13.5)"/><ellipse cx="12.5" cy="13.5" rx="4" ry="1.4" transform="rotate(90 12.5 13.5)"/><ellipse cx="12.5" cy="13.5" rx="4" ry="1.4" transform="rotate(150 12.5 13.5)"/><circle cx="12.5" cy="13.5" r="0.8" fill="#00D8FF"/></g></svg>'''

SVG_FOLDER_REACT_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/><g stroke="#00D8FF" stroke-width="0.8" fill="none" transform="translate(1, 2)"><ellipse cx="12.5" cy="13.5" rx="4" ry="1.4" transform="rotate(30 12.5 13.5)"/><ellipse cx="12.5" cy="13.5" rx="4" ry="1.4" transform="rotate(90 12.5 13.5)"/><ellipse cx="12.5" cy="13.5" rx="4" ry="1.4" transform="rotate(150 12.5 13.5)"/><circle cx="12.5" cy="13.5" r="0.8" fill="#00D8FF"/></g></svg>'''

SVG_FILE = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6d8086" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'''

SVG_PYTHON = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#356EA1" d="M15.6 15.5h-2c-1.4 0-2.3.9-2.3 2.3v1.8c0 .2-.1.3-.3.3h-.9c-.9 0-1.6-.4-2-1.2-.3-.6-.5-1.2-.5-1.8-.1-1.1-.1-2.2.3-3.3.3-.9.9-1.6 1.9-1.8h5.8c.1 0 .3 0 .3-.1v-.5s-.2-.1-.3-.1h-3.4c-.3 0-.4-.1-.4-.4V9.4c0-.7.3-1.2.9-1.4.5-.2 1-.4 1.5-.5 1.2-.2 2.4-.2 3.6.1.5.1 1 .3 1.4.6.4.4.7.8.6 1.4v3.6c0 1.4-.8 2.2-2.2 2.2-.7.1-1.4.1-2 .1zm-2.8-6c0 .4.3.8.8.8.4 0 .8-.4.8-.8s-.4-.7-.8-.8c-.5 0-.8.4-.8.8zm3.6 7h2c1.4 0 2.3-.9 2.3-2.3v-1.8c0-.2.1-.3.3-.3h.9c.9 0 1.6.4 2 1.2.3.6.5 1.2.5 1.8.1 1.1.1 2.2-.3 3.3-.3.9-.9 1.6-1.9 1.8h-5.8c-.1 0-.3 0-.3.1v.5s.2.1.3.1h3.4c.3 0 .4.1.4.4v1.3c0 .7-.3 1.2-.9 1.4-.5.2-1 .4-1.5.5-1.2.2-2.4.2-3.6-.1-.5-.1-1-.3-1.4-.6-.4-.4-.7-.8-.6-1.4v-3.6c0-1.4.8-2.2 2.2-2.2.7-.1 1.4-.1 2-.1zm2.8 6c0-.4-.3-.8-.8-.8-.4 0-.8.4-.8.8s.4.7.8.8c.5 0 .8-.4.8-.8z"/></svg>'''

SVG_GIT = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#CD3F45" d="M7 16.2v-.3c.1-.5.4-.7.7-1.1l4.8-4.8.2-.2s.1 0 .1.1l1.8 1.8c.1.1.1.2 0 .3-.1.6.1 1.2.6 1.5.2.1.2.2.2.4v4.4c0 .2-.1.3-.2.4-.5.3-.8.9-.6 1.5.2.6.7 1 1.3 1 .6 0 1.1-.4 1.3-.9.2-.6 0-1.2-.5-1.6-.2-.1-.2-.2-.2-.4v-4.5h.1l1.6 1.6c.1.1.1.2.1.2v.6c.1.8.8 1.3 1.6 1.2.8-.1 1.4-.9 1.2-1.7-.1-.7-.9-1.2-1.6-1.1-.1 0-.2 0-.4-.1l-1.7-1.7c-.1-.1-.1-.2-.1-.3.2-.9-.7-1.8-1.6-1.6-.1 0-.3 0-.3-.1-.6-.6-1.2-1.2-1.8-1.7-.1-.1-.1-.2 0-.3.5-.4.9-.9 1.3-1.3.6-.6 1.2-.6 1.8 0l7.6 7.6c.6.6.6 1.2 0 1.8L17 24.2c-.3.3-.6.7-1.1.8h-.2c-.2-.1-.5-.2-.7-.4-.6-.6-1.3-1.2-1.9-1.9l-5.5-5.5c-.1-.3-.5-.6-.6-1z"/></svg>'''

SVG_MD = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#529BBA" d="M20.7 6.7v9.9h3.8c-2.9 3-5.8 5.9-8.7 8.8-2.7-2.8-5.6-5.8-8.4-8.7h3.5V6.6c1.3.9 4.4 3.1 5 3.1.6 0 3.6-2.2 4.8-3z"/></svg>'''

SVG_JSON = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#DBCD68" d="M7.5 15.1c1.5 0 1.7-.8 1.7-1.5 0-.6-.1-1.1-.1-1.7S9 10.7 9 10.2c0-2.1 1.3-3 3.4-3h.8v1.9h-.4c-1 0-1.3.6-1.3 1.6 0 .4.1.8.1 1.3 0 .4.1.9.1 1.5 0 1.7-.7 2.3-1.9 2.6 1.2.3 1.9.9 1.9 2.6 0 .6-.1 1.1-.1 1.5 0 .4-.1.9-.1 1.2 0 1 .3 1.6 1.3 1.6h.4v1.9h-.8c-2 0-3.3-.8-3.3-3 0-.6 0-1.1.1-1.7.1-.6.1-1.2.1-1.7 0-.6-.2-1.5-1.7-1.5l-.1-1.9zm17 1.7c-1.5 0-1.7.9-1.7 1.5s.1 1.1.1 1.7c.1.6.1 1.2.1 1.7 0 2.2-1.4 3-3.4 3h-.8V23h.4c1 0 1.3-.6 1.3-1.6 0-.4 0-.8-.1-1.2 0-.5-.1-1-.1-1.5 0-1.7.7-2.3 1.9-2.6-1.2-.3-1.9-.9-1.9-2.6 0-.6.1-1.1.1-1.5.1-.5.1-.9.1-1.3 0-1-.4-1.5-1.3-1.6h-.4V7.2h.8c2.1 0 3.4.9 3.4 3 0 .6-.1 1.1-.1 1.7-.1.6-.1 1.2-.1 1.7 0 .7.2 1.5 1.7 1.5v1.7z"/></svg>'''

SVG_TSCONFIG = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#529BBA" d="M7.5 15.1c1.5 0 1.7-.8 1.7-1.5 0-.6-.1-1.1-.1-1.7S9 10.7 9 10.2c0-2.1 1.3-3 3.4-3h.8v1.9h-.4c-1 0-1.3.6-1.3 1.6 0 .4.1.8.1 1.3 0 .4.1.9.1 1.5 0 1.7-.7 2.3-1.9 2.6 1.2.3 1.9.9 1.9 2.6 0 .6-.1 1.1-.1 1.5 0 .4-.1.9-.1 1.2 0 1 .3 1.6 1.3 1.6h.4v1.9h-.8c-2 0-3.3-.8-3.3-3 0-.6 0-1.1.1-1.7.1-.6.1-1.2.1-1.7 0-.6-.2-1.5-1.7-1.5l-.1-1.9zm17 1.7c-1.5 0-1.7.9-1.7 1.5s.1 1.1.1 1.7c.1.6.1 1.2.1 1.7 0 2.2-1.4 3-3.4 3h-.8V23h.4c1 0 1.3-.6 1.3-1.6 0-.4 0-.8-.1-1.2 0-.5-.1-1-.1-1.5 0-1.7.7-2.3 1.9-2.6-1.2-.3-1.9-.9-1.9-2.6 0-.6.1-1.1.1-1.5.1-.5.1-.9.1-1.3 0-1-.4-1.5-1.3-1.6h-.4V7.2h.8c2.1 0 3.4.9 3.4 3 0 .6-.1 1.1-.1 1.7-.1.6-.1 1.2-.1 1.7 0 .7.2 1.5 1.7 1.5v1.7z"/></svg>'''

SVG_NPM = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#CD3F45" d="M4 11.3v8h6.8v1.4h5.3v-1.3H28v-8.1H4zm6.6 6.7H9.3v-3.9H8V18H5.3v-5.3h5.3V18zm6.6 0h-2.7v1.4h-2.7v-6.6h5.3c.1 1.6.1 3.4.1 5.2zm9.4 0h-1.3v-3.9H24V18h-1.4v-3.9h-1.3V18h-2.7v-5.3h8V18zm-10.7-3.9h-1.3v2.6h1.3v-2.6z"/></svg>'''

SVG_TOML = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#8f8f8f" d="M24.5 17.3c-.4-.1-.8-.3-1.1-.4 0-.7-.1-1.3-.1-2 0-.1.1-.1.1-.2.4-.2.7-.3 1.1-.5.4-.2.5-.6.4-1-.3-.7-.6-1.3-.9-2-.2-.4-.6-.6-1-.4-.4.2-.7.3-1.1.5-.1 0-.2 0-.2-.1-.2-.3-.5-.5-.7-.7-.2-.2-.5-.4-.7-.6.2-.4.3-.8.5-1.2.2-.5 0-.9-.5-1.1-.6-.1-1.3-.4-1.9-.6-.5-.2-.9 0-1.1.5-.1.4-.3.8-.4 1.1-.7 0-1.3.1-2 .1-.1 0-.1-.1-.2-.1-.2-.4-.3-.7-.5-1.1-.2-.4-.6-.5-1-.4-.7.3-1.3.6-2 .9-.4.2-.6.6-.4 1 .2.4.3.7.5 1.1 0 .1 0 .2-.1.2-.2.2-.4.3-.5.5-.3.3-.5.6-.8.9-.4-.1-.8-.3-1.1-.4-.5-.2-.9 0-1.1.5-.2.5-.5 1.2-.7 1.8-.2.6-.1.9.5 1.1.4.1.8.3 1.1.4 0 .7.1 1.3.1 2 0 .1-.1.1-.1.2-.4.2-.7.3-1.1.5-.4.2-.5.6-.4 1 .3.7.6 1.3.9 2 .2.4.6.6 1 .4.4-.2.7-.3 1.1-.5.1 0 .2 0 .2.1.2.3.5.5.7.7.2.2.5.4.7.6-.2.4-.3.8-.5 1.2-.2.5 0 .9.5 1.1.6.2 1.2.5 1.9.7.6.2.9.1 1.1-.5.1-.4.3-.8.4-1.1.7 0 1.3-.1 2-.1.1 0 .1.1.2.1.2.4.3.7.5 1.1.2.4.6.5 1 .4.7-.3 1.3-.6 2-.9.4-.2.6-.6.4-1-.2-.4-.3-.7-.5-1.1 0-.1 0-.2.1-.2.3-.2.5-.5.7-.7.2-.2.4-.5.6-.7.4.1.8.3 1.1.4.5.2.9 0 1.1-.5.2-.6.5-1.2.7-1.9.2-.5.1-.9-.5-1.1zm-7 2.1c-1.9.8-4 0-4.9-1.9-.8-1.9 0-4 1.9-4.9 1.9-.8 4 0 4.9 1.9.8 1.9 0 4-1.9 4.9z"/></svg>'''

SVG_HTML = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#EF7623" d="M8 15l6-5.6V12l-4.5 4 4.5 4v2.6L8 17v-2zm16 2.1l-6 5.6V20l4.6-4-4.6-4V9.3l6 5.6v2.2z"/></svg>'''

SVG_CSS = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#529BBA" d="M10.3 23.3l.8-4H8.6v-2.1h3l.5-2.5H9.5v-2.1h3.1l.8-3.9h2.8l-.8 3.9h2.8l.8-3.9h2.8l-.8 3.9h2.5v2.1h-2.9l-.6 2.5h2.6v2.1h-3l-.8 4H16l.8-4H14l-.8 4h-2.9zm6.9-6.1l.5-2.5h-2.8l-.5 2.5h2.8z"/></svg>'''

SVG_JS = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#F1DD3F" d="M11.4 10h2.7v7.6c0 3.4-1.6 4.6-4.3 4.6-.6 0-1.5-.1-2-.3l.3-2.2c.4.2.9.3 1.4.3 1.1 0 1.9-.5 1.9-2.4V10zm5.1 9.2c.7.4 1.9.8 3 .8 1.3 0 1.9-.5 1.9-1.3s-.6-1.2-2-1.7c-2-.7-3.3-1.8-3.3-3.6 0-2.1 1.7-3.6 4.6-3.6 1.4 0 2.4.3 3.1.6l-.6 2.2c-.5-.2-1.3-.6-2.5-.6s-1.8.5-1.8 1.2c0 .8.7 1.1 2.2 1.7 2.1.8 3.1 1.9 3.1 3.6 0 2-1.6 3.7-4.9 3.7-1.4 0-2.7-.4-3.4-.7l.6-2.3z"/></svg>'''

SVG_TS = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#529BBA" d="M15.6 11.8h-3.4V22H9.7V11.8H6.3V10h9.2v1.8zm7.7 7.1c0-.5-.2-.8-.5-1.1-.3-.3-.9-.5-1.7-.8-1.4-.4-2.5-.9-3.3-1.5-.7-.6-1.1-1.3-1.1-2.3 0-1 .4-1.8 1.3-2.4.8-.6 1.9-.9 3.2-.9 1.3 0 2.4.4 3.2 1.1.8.7 1.2 1.6 1.2 2.6h-2.3c0-.6-.2-1-.6-1.4-.4-.3-.9-.5-1.6-.5-.6 0-1.1.1-1.5.4-.4.3-.5.7-.5 1.1 0 .4.2.7.6 1 .4.3 1 .5 2 .8 1.3.4 2.3.9 3 1.5.7.6 1 1.4 1 2.4s-.4 1.9-1.2 2.4c-.8.6-1.9.9-3.2.9-1.3 0-2.5-.3-3.4-1s-1.5-1.6-1.4-2.9h2.4c0 .7.2 1.2.7 1.6.4.3 1.1.5 1.8.5s1.2-.1 1.5-.4c.2-.3.4-.7.4-1.1z"/></svg>'''

SVG_SHELL = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4CAF50" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-8v-2h8v2zm0-4h-8v-2h8v2zm0-4h-8V7h8v2z"/></svg>'''

SVG_IMAGE = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4CAF50" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>'''

SVG_REACT = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#529BBA" d="M22 19.4c.1 1.1.2 2.1.2 3.2 0 1.3-.7 2.2-1.7 2.3-.5.1-1.1 0-1.6-.2-1-.5-1.9-1.2-2.9-1.8-.5.4-1 .8-1.6 1.2-.3.2-.7.4-1 .5-1.8.8-3.3-.1-3.4-2.1 0-1 .1-2.1.2-3.2-.6-.2-1.2-.4-1.8-.8-.6-.3-1.1-.7-1.6-1.2-.9-.9-.8-2 .1-2.9.8-.9 1.9-1.3 3-1.7.1 0 .3-.1.4-.1-.1-.7-.2-1.5-.3-2.2 0-.6.1-1.3.2-1.9.3-1.1 1.3-1.6 2.5-1.3 1.2.3 2.1 1 2.9 1.7.2.1.3.3.4.4.8-.6 1.6-1.2 2.5-1.7.6-.4 1.3-.6 2-.4 1 .2 1.6 1.1 1.7 2.4v1.6c0 .5-.2 1-.3 1.6.6.2 1.1.4 1.7.7.8.4 1.6.8 2.1 1.6.5.7.5 1.5 0 2.2-.5.8-1.3 1.2-2.1 1.6-.6.1-1.1.3-1.6.5zm-5.8-.1c.3 0 .8-.1 1.2-.1.3 0 .5-.1.7-.4.5-.8 1-1.6 1.4-2.5.1-.2.1-.5 0-.6-.5-.9-1-1.7-1.5-2.5-.1-.2-.3-.3-.5-.3-.9 0-1.7 0-2.6-.1-.5 0-.9.2-1.2.7-.2.3-.4.6-.6 1-1.1 2-1.1 1.2 0 3.2 1.2 1.9.6 1.5 3.1 1.6zm-5.8-.8c.3-.8.6-1.6.9-2.3v-.4c-.3-.8-.6-1.5-.9-2.3-1 .3-2 .7-2.8 1.3-.9.7-.9 1.6 0 2.3.8.8 1.8 1.1 2.8 1.4zm11.3-5.1c-.4.9-.7 1.7-1 2.5 0 .1-.1.2 0 .2.3.8.6 1.6 1 2.6.9-.5 1.9-.9 2.7-1.4 1.1-.7 1.1-1.7 0-2.4-.8-.7-1.8-1-2.7-1.5zm-10.7-1c.9-.1 1.7-.2 2.5-.4.1 0 .2-.1.2-.1.5-.7 1-1.3 1.6-2-.8-.7-1.6-1.4-2.6-1.8-1.1-.4-1.8 0-2 1.2-.1 1 .1 2 .3 3.1zm10 0c0-.1.1-.3.1-.4.2-1 .4-2.1 0-3.1-.2-.7-.7-1-1.3-.9-1.3.2-2.2 1.1-3.1 1.9.5.7 1 1.3 1.5 1.9l.3.3c.8.1 1.6.2 2.5.3zm-10 7.2c-.2 1.1-.5 2.1-.2 3.2.2 1 .9 1.4 1.9 1.1 1.1-.3 1.9-1.1 2.7-1.8-.5-.7-1-1.3-1.6-2-.1-.1-.2-.2-.3-.2-.8 0-1.6-.1-2.5-.3zm5.6 2.5c.6.8 1.8 1.6 2.6 1.9 1 .3 1.7 0 1.9-1.1.2-1.1 0-2.1-.2-3.2-.9.1-1.8.1-2.6.4-.6.3-.9 1-1.3 1.5-.1.2-.2.3-.4.5zm.6-10.2c-.4-.5-.8-.9-1.2-1.4-.4.5-.7.9-1.2 1.4h2.4zm0 8.2h-2.3c.4.5.8.9 1.2 1.4.3-.5.7-.9 1.1-1.4zm-4.1-1c-.4-.7-.8-1.3-1.2-2.1-.2.6-.4 1.1-.6 1.7.5.2 1.1.3 1.8.4zm7-2.1l-1.2 2.1c.7-.1 1.2-.2 1.8-.3-.1-.6-.3-1.1-.6-1.8zm-8.2-2l1.2-2.1c-.7.1-1.2.2-1.8.3.2.7.3 1.2.6 1.8zm7-2.1c.2.4.4.7.6 1 .2.3.4.6.6 1 .2-.6.4-1.2.6-1.7-.6 0-1.1-.1-1.8-.3z"/></svg>'''

SVG_CONFIG = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#8f8f8f" d="M24.5 17.3c-.4-.1-.8-.3-1.1-.4 0-.7-.1-1.3-.1-2 0-.1.1-.1.1-.2.4-.2.7-.3 1.1-.5.4-.2.5-.6.4-1-.3-.7-.6-1.3-.9-2-.2-.4-.6-.6-1-.4-.4.2-.7.3-1.1.5-.1 0-.2 0-.2-.1-.2-.3-.5-.5-.7-.7-.2-.2-.5-.4-.7-.6.2-.4.3-.8.5-1.2.2-.5 0-.9-.5-1.1-.6-.1-1.3-.4-1.9-.6-.5-.2-.9 0-1.1.5-.1.4-.3.8-.4 1.1-.7 0-1.3.1-2 .1-.1 0-.1-.1-.2-.1-.2-.4-.3-.7-.5-1.1-.2-.4-.6-.5-1-.4-.7.3-1.3.6-2 .9-.4.2-.6.6-.4 1 .2.4.3.7.5 1.1 0 .1 0 .2-.1.2-.2.2-.4.3-.5.5-.3.3-.5.6-.8.9-.4-.1-.8-.3-1.1-.4-.5-.2-.9 0-1.1.5-.2.5-.5 1.2-.7 1.8-.2.6-.1.9.5 1.1.4.1.8.3 1.1.4 0 .7.1 1.3.1 2 0 .1-.1.1-.1.2-.4.2-.7.3-1.1.5-.4.2-.5.6-.4 1 .3.7.6 1.3.9 2 .2.4.6.6 1 .4.4-.2.7-.3 1.1-.5.1 0 .2 0 .2.1.2.3.5.5.7.7.2.2.5.4.7.6-.2.4-.3.8-.5 1.2-.2.5 0 .9.5 1.1.6.2 1.2.5 1.9.7.6.2.9.1 1.1-.5.1-.4.3-.8.4-1.1.7 0 1.3-.1 2-.1.1 0 .1.1.2.1.2.4.3.7.5 1.1.2.4.6.5 1 .4.7-.3 1.3-.6 2-.9.4-.2.6-.6.4-1-.2-.4-.3-.7-.5-1.1 0-.1 0-.2.1-.2.3-.2.5-.5.7-.7.2-.2.4-.5.6-.7.4.1.8.3 1.1.4.5.2.9 0 1.1-.5.2-.6.5-1.2.7-1.9.2-.5.1-.9-.5-1.1zm-7 2.1c-1.9.8-4 0-4.9-1.9-.8-1.9 0-4 1.9-4.9 1.9-.8 4 0 4.9 1.9.8 1.9 0 4-1.9 4.9z"/></svg>'''

SVG_ENV = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#9B59B6" d="M24.5 17.3c-.4-.1-.8-.3-1.1-.4 0-.7-.1-1.3-.1-2 0-.1.1-.1.1-.2.4-.2.7-.3 1.1-.5.4-.2.5-.6.4-1-.3-.7-.6-1.3-.9-2-.2-.4-.6-.6-1-.4-.4.2-.7.3-1.1.5-.1 0-.2 0-.2-.1-.2-.3-.5-.5-.7-.7-.2-.2-.5-.4-.7-.6.2-.4.3-.8.5-1.2.2-.5 0-.9-.5-1.1-.6-.1-1.3-.4-1.9-.6-.5-.2-.9 0-1.1.5-.1.4-.3.8-.4 1.1-.7 0-1.3.1-2 .1-.1 0-.1-.1-.2-.1-.2-.4-.3-.7-.5-1.1-.2-.4-.6-.5-1-.4-.7.3-1.3.6-2 .9-.4.2-.6.6-.4 1 .2.4.3.7.5 1.1 0 .1 0 .2-.1.2-.2.2-.4.3-.5.5-.3.3-.5.6-.8.9-.4-.1-.8-.3-1.1-.4-.5-.2-.9 0-1.1.5-.2.5-.5 1.2-.7 1.8-.2.6-.1.9.5 1.1.4.1.8.3 1.1.4 0 .7.1 1.3.1 2 0 .1-.1.1-.1.2-.4.2-.7.3-1.1.5-.4.2-.5.6-.4 1 .3.7.6 1.3.9 2 .2.4.6.6 1 .4.4-.2.7-.3 1.1-.5.1 0 .2 0 .2.1.2.3.5.5.7.7.2.2.5.4.7.6-.2.4-.3.8-.5 1.2-.2.5 0 .9.5 1.1.6.2 1.2.5 1.9.7.6.2.9.1 1.1-.5.1-.4.3-.8.4-1.1.7 0 1.3-.1 2-.1.1 0 .1.1.2.1.2.4.3.7.5 1.1.2.4.6.5 1 .4.7-.3 1.3-.6 2-.9.4-.2.6-.6.4-1-.2-.4-.3-.7-.5-1.1 0-.1 0-.2.1-.2.3-.2.5-.5.7-.7.2-.2.4-.5.6-.7.4.1.8.3 1.1.4.5.2.9 0 1.1-.5.2-.6.5-1.2.7-1.9.2-.5.1-.9-.5-1.1zm-7 2.1c-1.9.8-4 0-4.9-1.9-.8-1.9 0-4 1.9-4.9 1.9-.8 4 0 4.9 1.9.8 1.9 0 4-1.9 4.9z"/></svg>'''

SVG_SQL = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#DBCD68" d="M16.4 14c-2.4 0-4.7-.1-7-.6-.6-.1-1.1-.4-1.7-.6-.3-.1-.4-.3-.4-.6V8.7c0-.2.1-.4.3-.4.7-.3 1.3-.6 2-.7C12.1 7 14.5 7 17 7c2 0 4.1.2 6 .7.4.1.9.3 1.3.5.3.1.4.3.4.6v3.5c0 .2-.2.4-.3.5-.4.2-.8.4-1.2.5-1.4.2-2.8.5-4.2.6-.9.1-1.8 0-2.6.1zm8.3.2v3.6c0 .2-.3.5-.5.5-.6.2-1.3.5-1.9.6-2.8.5-5.7.6-8.6.5-1.6-.1-3.3-.2-4.9-.7-.4-.1-.8-.3-1.2-.5-.2-.1-.3-.3-.3-.5v-3.5c2.9 1 5.8 1.1 8.7 1.1 2.9.1 5.8-.1 8.7-1.1zm0 5.6v3.5c0 .2-.3.5-.5.6-.8.3-1.6.6-2.4.7-4 .6-8 .6-12.1-.1-.7-.1-1.4-.4-2-.6-.3-.1-.4-.3-.4-.7v-3.4c2.8 1 5.7 1.1 8.7 1.1 2.9 0 5.8-.1 8.7-1.1z"/></svg>'''

SVG_RUST = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#DEA584" d="M19 12.5a7 7 0 1 1-7-7 7 7 0 0 1 7 7zm1-4.2a1 1 0 0 0-.8.2L18.4 8a8 8 0 0 0-1.2-1.2l.6-.8a1 1 0 0 0-.2-1.4 1 1 0 0 0-1.4.2l-.6.8a8 8 0 0 0-1.6-.6V4a1 1 0 0 0-2 0v1a8 8 0 0 0-1.6.6l-.6-.8a1 1 0 0 0-1.4-.2 1 1 0 0 0-.2 1.4l.6.8A8 8 0 0 0 7.2 8l-.8-.6a1 1 0 0 0-1.4.2 1 1 0 0 0 .2 1.4l.8.6a8 8 0 0 0-.6 1.6H4a1 1 0 0 0 0 2h1a8 8 0 0 0 .6 1.6l-.8.6a1 1 0 0 0-.2 1.4 1 1 0 0 0 1.4-.2l.8-.6a8 8 0 0 0 1.2 1.2l-.6.8a1 1 0 0 0 .2 1.4 1 1 0 0 0 1.4-.2l.6-.8a8 8 0 0 0 1.6.6v1a1 1 0 0 0 2 0v-1a8 8 0 0 0 1.6-.6l.6.8a1 1 0 0 0 1.4.2 1 1 0 0 0 .2-1.4l-.6-.8a8 8 0 0 0 1.2-1.2l.8.6a1 1 0 0 0 1.4-.2 1 1 0 0 0-.2-1.4l-.8-.6a8 8 0 0 0 .6-1.6h1a1 1 0 0 0 0-2h-1a8 8 0 0 0-.6-1.6l.8-.6a1 1 0 0 0 .2-1.4 1 1 0 0 0-1.4.2z"/></svg>'''

SVG_GO = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#00ADD8" d="M14.2 10.6c-.6 0-1 .4-1.2.9h2.3c-.1-.5-.5-.9-1.1-.9zm7.2 2.6c0 1.6-1.1 2.9-2.9 2.9h-8c-2.4 0-4.1-1.7-4.1-4.1s1.7-4.1 4.1-4.1h8c1.8 0 2.9 1.3 2.9 2.9v1.2H12v1.2h8v1.2zm-18.7-2c-.6 0-1 .4-1.2.9h2.3c-.1-.5-.5-.9-1.1-.9zm5.3.9c0 .6-.4 1.1-1 1.1H4.6c-.1 0-.2-.1-.2-.2v-1.8c0-.1.1-.2.2-.2H7c.6 0 1 .5 1 1.1z"/></svg>'''

SVG_PHP = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#777BB4" d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2zm-5 13H5.5V9H7c.8 0 1.5.3 1.5 1.5S7.8 12 7 12H5.5zm6.5 0h-1.5V9H15c.8 0 1.5.3 1.5 1.5s-.7 1.5-1.5 1.5h-1.5zm5.5 0h-1.5V9H19c.8 0 1.5.3 1.5 1.5S19.8 12 19 12h-1.5z"/></svg>'''

SVG_RUBY = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#CC342D" d="M12 2L2 9l3 11h14l3-11-10-7zm4 8l-4 6-4-6 4-2 4 2z"/></svg>'''

SVG_DOCKER = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="#519ABA"><path d="M14.5 8.6h2v2h-2zm0 2.3h2v2h-2zm0 2.4h2v2h-2zm-2.3-2.4h2v2h-2zm0 2.4h2v2h-2zm-2.4-2.4h2v2h-2zm0 2.4h2v2h-2zm-2.3 0h2v2h-2zm9.4 0h2v2h-2z"/><path d="M27.1 13.6c-.4-.1-.9-.2-1.3-.2-.5.1-.8-.1-1-.6-.2-.5-.5-.9-.9-1.2-.6-.7-1.2-.5-1.5.3-.2.7-.2 1.5-.1 2.2.2.9.1 1.1-.8 1.3-1.1.3-16.3.2-16.3.2-.2 0-.3.5-.3 1s.1 2 .4 2.7c1 2.2 2.7 3.8 5.2 4H15c2.9-.1 5.2-1.5 7.2-3.6.8-.9 1.5-1.9 2-3 .2-.4.5-.6.9-.7.7-.1 1.3-.2 1.8-.6.1-.2.3-.4.4-.5.7-.5.6-1.1-.2-1.3zm-14.9 5.1c.4 0 .8.3.8.8s-.3.8-.8.8c-.4 0-.8-.3-.8-.8s.4-.8.8-.8zm-4.9 2.2c.8-.1 1.6.1 2.3-.1.9-.3 1.6-.2 2.1.8.3.6 1.0.9 1.7 1.3-2.2.3-4.6-.5-6.1-2z"/></g></svg>'''

SVG_YAML = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#CB3837" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6zm-5.5 4h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'''

SVG_XML = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#5c6bc0" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-3 15.5L8.5 15l2.5-2.5V11l-4 4 4 4v-1.5zm6 0v-1.5l-2.5-2.5 2.5-2.5V11l-4 4 4 4z"/></svg>'''

SVG_CPP = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#00599C" d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2zm1 12H9v-4h4V8H7v8h6v-2zm7-2h-2v2h-1v-2h-2v-1h2V9h1v2h2v1z"/></svg>'''

SVG_JAVA = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#EA2D42" d="M2 12A10 10 0 0 0 12 22a10 10 0 0 0 10-10A10 10 0 0 0 12 2a10 10 0 0 0-10 10zm12-5c0 1-.5 1.5-1.5 2S11 10 11 11h2c0-.5.5-.8 1.5-1.2s1.5-1.1 1.5-2.1c0-2-2-2.5-3.5-2v2c1-.3 1.5 0 1.5.3zm-5.5 8.5C8.8 15 10 14.2 11 13.5v-1.2c-.8.5-1.8 1.1-2.5 1.5V12H7.2v3.5h1.3z"/></svg>'''

SVG_CSHARP = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#178600" d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2zm1 12H9v-4h4V8H7v8h6v-2zm5-1.5h1.5v-1H18v-1.5h-1V11h-1.5v-1.5h-1V11H13v1h1.5v1.5H13v1h1.5V16h1v-1.5H17v1.5h1v-1.5h1v-1h-1v-1.5zm-2 1.5h-1.5v-1.5H16v1.5z"/></svg>'''

SVG_VUE = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#41B883" d="M12 2L2 19h4l6-10.4L18 19h4L12 2zm0 5.2L7.5 15h9L12 7.2z"/><path fill="#35495E" d="M12 10.7L9.5 15h5L12 10.7z"/></svg>'''

def _render_svg(svg_bytes: bytes) -> QIcon:
    icon = QIcon()
    renderer = QSvgRenderer(QByteArray(svg_bytes))
    # Render sizes for 18x18 base (explorer)
    for size in (18, 36, 54, 72):
        image = QImage(size, size, QImage.Format_ARGB32)
        image.fill(Qt.transparent)
        painter = QPainter(image)
        painter.setRenderHint(QPainter.Antialiasing)
        renderer.render(painter)
        painter.end()
        pixmap = QPixmap.fromImage(image)
        pixmap.setDevicePixelRatio(size / 18.0)
        icon.addPixmap(pixmap)
        
    # Render sizes for 16x16 base (tabs)
    for size in (16, 32, 48, 64):
        image = QImage(size, size, QImage.Format_ARGB32)
        image.fill(Qt.transparent)
        painter = QPainter(image)
        painter.setRenderHint(QPainter.Antialiasing)
        renderer.render(painter)
        painter.end()
        pixmap = QPixmap.fromImage(image)
        pixmap.setDevicePixelRatio(size / 16.0)
        icon.addPixmap(pixmap)
        
    return icon


def get_file_icon(filepath: str) -> QIcon:
    """Get appropriate SVG icon for a file."""
    name = os.path.basename(filepath).lower()
    ext = os.path.splitext(name)[1]

    if name in (".gitignore", ".git"):
        return _render_svg(SVG_GIT)
    if name.startswith(".env"):
        return _render_svg(SVG_ENV)
    if name in ("package.json", "package-lock.json"):
        return _render_svg(SVG_NPM)
    if name in ("tsconfig.json", "tsconfig.node.json") or ext == ".tsbuildinfo":
        return _render_svg(SVG_TSCONFIG)
    if name.endswith(".md"):
        return _render_svg(SVG_MD)
    if name.endswith(".json"):
        return _render_svg(SVG_JSON)
    if name.endswith(".toml"):
        return _render_svg(SVG_CONFIG)
    if name in ("dockerfile", "docker-compose.yml", "docker-compose.yaml", ".dockerignore"):
        return _render_svg(SVG_DOCKER)
    if ext in (".py", ".pyc", ".pyw"):
        return _render_svg(SVG_PYTHON)
    if ext in (".html", ".htm"):
        return _render_svg(SVG_HTML)
    if ext in (".css", ".scss", ".sass", ".less"):
        return _render_svg(SVG_CSS)
    if ext in (".js", ".mjs", ".cjs"):
        return _render_svg(SVG_JS)
    if ext in (".ts", ".mts", ".cts"):
        return _render_svg(SVG_TS)
    if ext in (".jsx", ".tsx"):
        return _render_svg(SVG_REACT)
    if ext == ".sql":
        return _render_svg(SVG_SQL)
    if ext == ".rs":
        return _render_svg(SVG_RUST)
    if ext == ".go":
        return _render_svg(SVG_GO)
    if ext == ".php":
        return _render_svg(SVG_PHP)
    if ext == ".rb":
        return _render_svg(SVG_RUBY)
    if ext in (".yaml", ".yml"):
        return _render_svg(SVG_YAML)
    if ext == ".xml":
        return _render_svg(SVG_XML)
    if ext in (".cpp", ".c", ".hpp", ".h", ".cc", ".cxx"):
        return _render_svg(SVG_CPP)
    if ext in (".java", ".class", ".jar"):
        return _render_svg(SVG_JAVA)
    if ext == ".cs":
        return _render_svg(SVG_CSHARP)
    if ext == ".vue":
        return _render_svg(SVG_VUE)
    if ext in (".sh", ".bat", ".cmd", ".ps1", ".bash"):
        return _render_svg(SVG_SHELL)
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp", ".ico", ".webp"):
        return _render_svg(SVG_IMAGE)
    
    return _render_svg(SVG_FILE)


def get_folder_icon(foldername: str = "", is_open: bool = False) -> QIcon:
    """Get appropriate SVG icon for a folder."""
    if isinstance(foldername, bool):
        is_open = foldername
        foldername = ""
    name = foldername.lower()
    if name == "node_modules":
        return _render_svg(SVG_FOLDER_NODE_OPEN if is_open else SVG_FOLDER_NODE)
    elif name in ("src", "source"):
        return _render_svg(SVG_FOLDER_SRC_OPEN if is_open else SVG_FOLDER_SRC)
    elif name == "public":
        return _render_svg(SVG_FOLDER_PUBLIC_OPEN if is_open else SVG_FOLDER_PUBLIC)
    elif name in (".next", "next"):
        return _render_svg(SVG_FOLDER_NEXT_OPEN if is_open else SVG_FOLDER_NEXT)
    elif name == "components":
        return _render_svg(SVG_FOLDER_REACT_OPEN if is_open else SVG_FOLDER_REACT)

    if is_open:
        return _render_svg(SVG_FOLDER_OPEN)
    return _render_svg(SVG_FOLDER)


class FileExplorer(QWidget):
    file_selected = Signal(str)
    root_changed = Signal(str)

    def __init__(self, root_path: str = None, parent=None):
        super().__init__(parent)
        self._root_path = root_path  # Keep None if no folder is open
        self._git_status = {}
        self._git_folders = set()
        self._in_inline_edit = False
        self._force_expand_root = True  # Flag to force expansion on first load or when root changes
        self._welcome_widget = None
        self.setObjectName("fileExplorer")
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("""
            background-color: #000000;
            border-bottom: 1px solid #000000;
        """)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(20, 0, 8, 0)
        header_layout.setSpacing(4)

        title = QLabel("EXPLORER")
        title.setStyleSheet("""
            color: #bbbbbb;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 1.2px;
        """)
        header_layout.addWidget(title)
        header_layout.addStretch()

        # Action buttons on header (VS Code style)
        for icon_text, tooltip, callback in [
            ("+", "New File", self._new_file),
            ("\U0001F4C1", "New Folder", self._new_folder),
            ("\u21BB", "Refresh", self._refresh),
            ("\U0001F4C2", "Open Folder", self._open_folder),
        ]:
            btn = QPushButton(icon_text)
            btn.setFixedSize(20, 20)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: none;
                    color: #cccccc;
                    font-size: 11px;
                    border-radius: 3px;
                }
                QPushButton:hover {
                    background-color: rgba(90, 93, 94, 0.31);
                    color: #ffffff;
                }
            """)
            btn.clicked.connect(callback)
            header_layout.addWidget(btn)

        layout.addWidget(header)

        self._welcome_widget = QWidget()
        self._welcome_widget.setStyleSheet("background-color: #000000;")
        welcome_layout = QVBoxLayout(self._welcome_widget)
        welcome_layout.setAlignment(Qt.AlignCenter)
        welcome_layout.setContentsMargins(20, 20, 20, 20)

        folder_icon = QLabel("\U0001F4C2")
        folder_icon.setStyleSheet("font-size: 48px;")
        folder_icon.setAlignment(Qt.AlignCenter)
        welcome_layout.addWidget(folder_icon)

        no_folder_label = QLabel("No folder opened")
        no_folder_label.setStyleSheet("color: #858585; font-size: 13px; padding: 10px;")
        no_folder_label.setAlignment(Qt.AlignCenter)
        welcome_layout.addWidget(no_folder_label)

        open_folder_btn = QPushButton("Open Folder")
        open_folder_btn.setFixedWidth(140)
        open_folder_btn.setCursor(Qt.PointingHandCursor)
        open_folder_btn.setStyleSheet("""
            QPushButton {
                background-color: #3c0068; color: #ffffff; border: none;
                padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold;
            }
            QPushButton:hover { background-color: #4a0072; }
        """)
        open_folder_btn.clicked.connect(self._open_folder)
        welcome_layout.addWidget(open_folder_btn, alignment=Qt.AlignCenter)

        layout.addWidget(self._welcome_widget)

        # Tree widget
        self._tree = QTreeWidget()
        self._tree.setStyle(TreeBranchStyle())
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(12)
        self._tree.setAnimated(True)
        self._tree.setExpandsOnDoubleClick(True)
        self._tree.setRootIsDecorated(True)
        self._tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tree.customContextMenuRequested.connect(self._show_context_menu)
        self._tree.itemExpanded.connect(self._on_item_expanded)
        self._tree.itemCollapsed.connect(self._on_item_collapsed)
        self._tree.itemClicked.connect(self._on_item_clicked)
        self._tree.setIconSize(QSize(18, 18))

        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-family: "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
                font-size: 12px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 1px 2px;
                min-height: 22px;
                border: none;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover:!selected {
                background-color: #2a2d2e;
            }
            QTreeWidget::item:focus {
                background-color: #04395e;
                outline: none;
            }
        """)
        layout.addWidget(self._tree)

        self._tree.itemChanged.connect(self._on_item_changed)
        
        # Only refresh if we have a root path
        if self._root_path:
            self._welcome_widget.hide()
            self._tree.show()
            self._refresh()
        else:
            self._welcome_widget.show()
            self._tree.hide()

    def _load_directory(self, path: str, parent_item: QTreeWidgetItem = None):
        try:
            entries = sorted(
                os.listdir(path),
                key=lambda x: (not os.path.isdir(os.path.join(path, x)), x.lower())
            )
        except (PermissionError, OSError):
            return

        for name in entries:
            if name.startswith(".") and name not in (".gitignore", ".env", ".dockerignore", ".next", ".venv", ".github"):
                continue
            if name in ("__pycache__", ".git"):
                continue

            full_path = os.path.join(path, name)
            item = QTreeWidgetItem()
            item.setText(0, name)
            item.setData(0, Qt.UserRole, full_path)
            item.setToolTip(0, full_path)

            # Git Status coloring
            try:
                rel_path = os.path.relpath(full_path, self._root_path)
                rel_path_norm = rel_path.replace("/", os.sep).replace("\\", os.sep)
            except Exception:
                rel_path_norm = ""

            is_dir = os.path.isdir(full_path)
            if is_dir:
                item.setIcon(0, get_folder_icon(name, False))
                item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                # Lazy load placeholder
                QTreeWidgetItem(item)
                
                # Color folder if it has changes inside
                if rel_path_norm in self._git_folders:
                    item.setForeground(0, QColor("#e2c08d"))
            else:
                item.setIcon(0, get_file_icon(full_path))
                
                # Color file based on its git status
                if rel_path_norm in self._git_status:
                    status = self._git_status[rel_path_norm]
                    if status == "M":
                        item.setForeground(0, QColor("#e2c08d"))  # Yellow for modified
                    elif status in ("A", "?"):
                        item.setForeground(0, QColor("#73c991"))  # Green for added/untracked

            if parent_item:
                parent_item.addChild(item)
            else:
                self._tree.addTopLevelItem(item)

    def _on_item_expanded(self, item: QTreeWidgetItem):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isdir(path):
            item.takeChildren()
            self._load_directory(path, item)
            if path != self._root_path:
                item.setIcon(0, get_folder_icon(item.text(0), True))
            else:
                self.setMaximumHeight(16777215)

    def _on_item_collapsed(self, item: QTreeWidgetItem):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isdir(path):
            if path != self._root_path:
                item.setIcon(0, get_folder_icon(item.text(0), False))
            else:
                self.setMaximumHeight(60)

    def _on_item_clicked(self, item: QTreeWidgetItem, column: int):
        path = item.data(0, Qt.UserRole)
        if not path:
            return
        if os.path.isfile(path):
            self.file_selected.emit(path)
        elif os.path.isdir(path):
            # Calculate item depth to determine the bounds of the branch indicator
            depth = 0
            parent = item.parent()
            while parent:
                depth += 1
                parent = parent.parent()
            
            indent = self._tree.indentation()
            pos = self._tree.viewport().mapFromGlobal(QCursor.pos())
            
            # Only toggle expansion manually if clicking on the actual item text/icon (x >= indent boundaries)
            # Clicking on the chevron (x < boundary) is already handled automatically by QTreeWidget
            if pos.x() >= (depth + 1) * indent:
                if item.isExpanded():
                    self._tree.collapseItem(item)
                else:
                    self._tree.expandItem(item)

    def _refresh_git_status(self):
        self._git_status = {}
        self._git_folders = set()
        
        # Check if it is a git repo
        try:
            import subprocess
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
            result = subprocess.run(
                ["git", "status", "--porcelain", "-u"],
                cwd=self._root_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3,
                **kwargs
            )
            if result.returncode != 0:
                return
            
            for line in result.stdout.splitlines():
                if len(line) < 3:
                    continue
                xy = line[:2]
                path = line[3:].strip().replace("/", os.sep)
                # Parse status
                status = '?' if '?' in xy else ('M' if 'M' in xy or 'R' in xy else 'A')
                self._git_status[path] = status
                
                # Add parents to self._git_folders
                parent = os.path.dirname(path)
                while parent:
                    self._git_folders.add(parent)
                    parent = os.path.dirname(parent)
        except Exception:
            pass

    def _get_expanded_paths(self) -> set:
        expanded = set()
        def traverse(item):
            path = item.data(0, Qt.UserRole)
            if path and os.path.isdir(path) and item.isExpanded():
                expanded.add(path)
            for i in range(item.childCount()):
                traverse(item.child(i))
        
        for i in range(self._tree.topLevelItemCount()):
            traverse(self._tree.topLevelItem(i))
        return expanded

    def _restore_expanded_paths(self, expanded_paths):
        if not expanded_paths:
            return
            
        def restore_item(item):
            path = item.data(0, Qt.UserRole)
            if path and path in expanded_paths:
                self._tree.expandItem(item)
            for i in range(item.childCount()):
                restore_item(item.child(i))

        for i in range(self._tree.topLevelItemCount()):
            restore_item(self._tree.topLevelItem(i))

    def _refresh(self):
        if not self._root_path:
            self._welcome_widget.show()
            self._tree.hide()
            return

        self._welcome_widget.hide()
        self._tree.show()

        # Save active expansion states
        expanded = self._get_expanded_paths()
        
        self._tree.clear()
        self._refresh_git_status()
        
        # Create collapsible root workspace item
        root_item = QTreeWidgetItem()
        root_item.setText(0, os.path.basename(self._root_path).upper())
        root_item.setData(0, Qt.UserRole, self._root_path)
        root_item.setToolTip(0, self._root_path)
        
        font = root_item.font(0)
        font.setBold(True)
        font.setPixelSize(11)
        root_item.setFont(0, font)
        
        root_item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
        QTreeWidgetItem(root_item)  # Lazy load placeholder
        
        self._tree.addTopLevelItem(root_item)
        
        # Expand root item if forced (first load/changed project) or if it was previously expanded
        if self._force_expand_root or self._root_path in expanded:
            self._tree.expandItem(root_item)
            self.setMaximumHeight(16777215)
        else:
            self.setMaximumHeight(60)
            
        self._force_expand_root = False  # Reset force flag
        
        # Restore other expansion states
        self._restore_expanded_paths(expanded)

    def _open_folder(self):
        start_dir = self._root_path if self._root_path else os.path.expanduser("~")
        folder = QFileDialog.getExistingDirectory(self, "Open Folder", start_dir)
        if folder:
            self._root_path = folder
            self._force_expand_root = True
            self._welcome_widget.hide()
            self._tree.show()
            self._refresh()
            self.root_changed.emit(folder)

    def _show_context_menu(self, position):
        item = self._tree.itemAt(position)

        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #454545;
                padding: 4px 0px;
                font-size: 12px;
            }
            QMenu::item {
                padding: 4px 28px 4px 12px;
                min-width: 150px;
            }
            QMenu::item:selected {
                background-color: #2c004a;
            }
            QMenu::separator {
                height: 1px;
                background: #454545;
                margin: 4px 0px;
            }
        """)

        if not item:
            new_file = QAction("New File...", self)
            new_file.triggered.connect(self._new_file)
            menu.addAction(new_file)
            new_folder = QAction("New Folder...", self)
            new_folder.triggered.connect(self._new_folder)
            menu.addAction(new_folder)
            menu.addSeparator()
            open_folder = QAction("Open Folder...", self)
            open_folder.triggered.connect(self._open_folder)
            menu.addAction(open_folder)
            menu.exec(self._tree.viewport().mapToGlobal(position))
            return

        path = item.data(0, Qt.UserRole)
        if not path:
            return

        is_root = (path == self._root_path)

        if os.path.isfile(path):
            open_action = QAction("Open", self)
            open_action.triggered.connect(lambda: self.file_selected.emit(path))
            menu.addAction(open_action)
            menu.addSeparator()

        if os.path.isdir(path):
            new_file = QAction("New File...", self)
            new_file.triggered.connect(lambda: self._new_file_in(path, item))
            menu.addAction(new_file)
            new_folder = QAction("New Folder...", self)
            new_folder.triggered.connect(lambda: self._new_folder_in(path, item))
            menu.addAction(new_folder)
            menu.addSeparator()

        if not is_root:
            rename_action = QAction("Rename...", self)
            rename_action.triggered.connect(lambda: self._rename_item(item, path))
            menu.addAction(rename_action)

            delete_action = QAction("Delete", self)
            delete_action.triggered.connect(lambda: self._delete_item(path))
            menu.addAction(delete_action)

            menu.addSeparator()

        copy_path = QAction("Copy Path", self)
        copy_path.triggered.connect(lambda: self._copy_path(path))
        menu.addAction(copy_path)

        if not is_root:
            copy_rel = QAction("Copy Relative Path", self)
            copy_rel.triggered.connect(lambda: self._copy_relative_path(path))
            menu.addAction(copy_rel)

        menu.exec(self._tree.viewport().mapToGlobal(position))

    def _copy_path(self, path: str):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(path)

    def _copy_relative_path(self, path: str):
        from PySide6.QtWidgets import QApplication
        rel = os.path.relpath(path, self._root_path)
        QApplication.clipboard().setText(rel)

    def _rename_item(self, item: QTreeWidgetItem, path: str):
        # Store temporary data for the rename operation
        item.setData(0, Qt.UserRole + 1, "rename")
        item.setData(0, Qt.UserRole + 2, path)
        
        # Make the item editable and trigger editing
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)

    def _delete_item(self, path: str):
        reply = QMessageBox.question(
            self, "Confirm Delete",
            f"Are you sure you want to delete '{os.path.basename(path)}'?\n\nThis action cannot be undone.",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            try:
                if os.path.isdir(path):
                    import shutil
                    shutil.rmtree(path)
                else:
                    os.remove(path)
                self._refresh()
            except Exception as e:
                QMessageBox.warning(self, "Error", str(e))

    def _new_file(self):
        curr = self._tree.currentItem()
        if curr:
            path = curr.data(0, Qt.UserRole)
            if os.path.isdir(path):
                self._new_file_in(path, curr)
                return
            else:
                parent = curr.parent()
                parent_path = parent.data(0, Qt.UserRole) if parent else self._root_path
                self._new_file_in(parent_path, parent)
                return
        self._new_file_in(self._root_path, None)

    def _new_folder(self):
        curr = self._tree.currentItem()
        if curr:
            path = curr.data(0, Qt.UserRole)
            if os.path.isdir(path):
                self._new_folder_in(path, curr)
                return
            else:
                parent = curr.parent()
                parent_path = parent.data(0, Qt.UserRole) if parent else self._root_path
                self._new_folder_in(parent_path, parent)
                return
        self._new_folder_in(self._root_path, None)

    def _new_file_in(self, parent_path: str, parent_item: QTreeWidgetItem = None):
        d = parent_path if os.path.isdir(parent_path) else os.path.dirname(parent_path)
        
        item = QTreeWidgetItem()
        item.setText(0, "untitled.py")
        item.setIcon(0, get_file_icon("untitled.py"))
        
        # Operation meta info
        item.setData(0, Qt.UserRole + 1, "create_file")
        item.setData(0, Qt.UserRole + 2, d)
        
        if parent_item:
            parent_item.addChild(item)
            self._tree.expandItem(parent_item)
        else:
            root_item = self._tree.topLevelItem(0) if self._tree.topLevelItemCount() > 0 else None
            if root_item:
                root_item.addChild(item)
                self._tree.expandItem(root_item)
            else:
                self._tree.addTopLevelItem(item)
            
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)

    def _new_folder_in(self, parent_path: str, parent_item: QTreeWidgetItem = None):
        d = parent_path if os.path.isdir(parent_path) else os.path.dirname(parent_path)
        
        item = QTreeWidgetItem()
        item.setText(0, "untitled_folder")
        item.setIcon(0, get_folder_icon("untitled_folder", False))
        
        # Operation meta info
        item.setData(0, Qt.UserRole + 1, "create_folder")
        item.setData(0, Qt.UserRole + 2, d)
        
        if parent_item:
            parent_item.addChild(item)
            self._tree.expandItem(parent_item)
        else:
            root_item = self._tree.topLevelItem(0) if self._tree.topLevelItemCount() > 0 else None
            if root_item:
                root_item.addChild(item)
                self._tree.expandItem(root_item)
            else:
                self._tree.addTopLevelItem(item)
            
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)

    def _on_item_changed(self, item: QTreeWidgetItem, column: int):
        if self._in_inline_edit:
            return

        operation = item.data(0, Qt.UserRole + 1)
        if not operation:
            return

        new_name = item.text(0).strip()
        
        # Revert editable flag and clear operations metadata immediately
        item.setFlags(item.flags() & ~Qt.ItemIsEditable)
        item.setData(0, Qt.UserRole + 1, None)
        
        if not new_name:
            if operation in ("create_file", "create_folder"):
                parent = item.parent()
                if parent:
                    parent.removeChild(item)
                else:
                    self._tree.takeTopLevelItem(self._tree.indexOfTopLevelItem(item))
            elif operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                self._in_inline_edit = True
                item.setText(0, os.path.basename(old_path))
                self._in_inline_edit = False
            return

        self._in_inline_edit = True
        try:
            if operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                new_path = os.path.join(os.path.dirname(old_path), new_name)
                if old_path != new_path:
                    os.rename(old_path, new_path)
                    item.setData(0, Qt.UserRole, new_path)
                    item.setToolTip(0, new_path)
                    if os.path.isfile(new_path):
                        item.setIcon(0, get_file_icon(new_path))
                    self._refresh()
            elif operation == "create_file":
                parent_dir = item.data(0, Qt.UserRole + 2)
                full_path = os.path.join(parent_dir, new_name)
                with open(full_path, "w") as f:
                    f.write("")
                item.setData(0, Qt.UserRole, full_path)
                item.setToolTip(0, full_path)
                item.setIcon(0, get_file_icon(full_path))
                self._refresh()
                self.file_selected.emit(full_path)
            elif operation == "create_folder":
                parent_dir = item.data(0, Qt.UserRole + 2)
                full_path = os.path.join(parent_dir, new_name)
                os.makedirs(full_path, exist_ok=True)
                item.setData(0, Qt.UserRole, full_path)
                item.setToolTip(0, full_path)
                item.setIcon(0, get_folder_icon(new_name, False))
                item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                QTreeWidgetItem(item) # lazy load placeholder
                self._refresh()
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Failed to perform operation: {str(e)}")
            if operation in ("create_file", "create_folder"):
                parent = item.parent()
                if parent:
                    parent.removeChild(item)
                else:
                    self._tree.takeTopLevelItem(self._tree.indexOfTopLevelItem(item))
            elif operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                item.setText(0, os.path.basename(old_path))
        finally:
            self._in_inline_edit = False

    def set_root(self, path: str):
        self._root_path = path
        self._force_expand_root = True
        if path:
            self._welcome_widget.hide()
            self._tree.show()
            self._refresh()
        else:
            self._welcome_widget.show()
            self._tree.hide()

    def get_root(self) -> str:
        return self._root_path

    def is_empty(self) -> bool:
        return self._root_path is None
