"""File Explorer - VS Code style file tree with file type icons."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem,
    QLabel, QPushButton, QHBoxLayout, QFileDialog, QMenu, QInputDialog,
    QMessageBox, QHeaderView, QStyledItemDelegate, QStyleOptionViewItem,
    QProxyStyle, QStyle, QSizePolicy,
)
from PySide6.QtCore import Signal, Qt, QSize, QPoint, QByteArray, QLocale, QFileSystemWatcher, QTimer
from PySide6.QtGui import QAction, QColor, QPainter, QPixmap, QIcon, QPen, QFont, QPolygonF, QCursor, QImage
from PySide6.QtSvg import QSvgRenderer

import shutil
import fnmatch
from .outline_panel import SectionHeaderButton
from ..core.config import get_config, get_hierarchical_config

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

            # Draw indent guide (vertical line) if not a top-level item or has siblings
            painter.setRenderHint(QPainter.Antialiasing, False)
            guide_pen = QPen(QColor(255, 255, 255, 25))
            painter.setPen(guide_pen)
            
            # State_Sibling means there's an item below it at the same level.
            # State_Item means this branch indicator is right next to an item.
            # For VS Code style, we just draw a vertical line connecting top and bottom if it has a sibling,
            # or from top to center if it's the last item.
            if option.state & QStyle.State_Sibling:
                painter.drawLine(cx, rect.top(), cx, rect.bottom())
            elif option.state & QStyle.State_Item:
                painter.drawLine(cx, rect.top(), cx, cy)
            
            painter.setRenderHint(QPainter.Antialiasing, True)

            # VS Code style chevron (lines, not solid triangle)
            if option.state & QStyle.State_Children:
                pen = QPen(QColor("#858585"))
                pen.setWidth(1) # VS Code uses a thin 1px chevron
                pen.setCapStyle(Qt.RoundCap)
                pen.setJoinStyle(Qt.RoundJoin)
                painter.setPen(pen)

                if option.state & QStyle.State_Open:
                    # v downward chevron
                    painter.drawLine(cx - 3, cy - 1, cx, cy + 2)
                    painter.drawLine(cx, cy + 2, cx + 3, cy - 1)
                else:
                    # > rightward chevron
                    painter.drawLine(cx - 1, cy - 3, cx + 2, cy)
                    painter.drawLine(cx + 2, cy, cx - 1, cy + 3)

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


class GitStatusDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        super().paint(painter, option, index)
        status = index.data(Qt.UserRole + 3) # We'll store status string here
        if status:
            painter.save()
            font = option.font
            font.setBold(True)
            font.setPixelSize(10)
            painter.setFont(font)
            
            if status == "M":
                color = QColor("#e2c08d")
            elif status in ("A", "U", "?"):
                color = QColor("#73c991")
                status = "U" if status == "?" else status
            elif status == "D":
                color = QColor("#e51400")
            else:
                color = QColor("#cccccc")
                
            painter.setPen(color)
            rect = option.rect
            painter.drawText(rect.adjusted(0, 0, -8, 0), Qt.AlignRight | Qt.AlignVCenter, status)
            painter.restore()


class ExplorerTreeWidget(QTreeWidget):
    """Custom tree widget to handle actual file moving on drag and drop."""
    file_dropped = Signal(str, str) # source_path, target_folder

    def keyPressEvent(self, event):
        parent_explorer = self.parent()
        
        # Handle Delete
        if event.key() == Qt.Key_Delete:
            selected = self.selectedItems()
            if selected and hasattr(parent_explorer, '_delete_items'):
                paths = [item.data(0, Qt.UserRole) for item in selected]
                parent_explorer._delete_items(paths)
                event.accept()
                return

        # Handle F2 (Rename)
        if event.key() == Qt.Key_F2:
            selected = self.selectedItems()
            if len(selected) == 1 and hasattr(parent_explorer, '_rename_item'):
                parent_explorer._rename_item(selected[0], selected[0].data(0, Qt.UserRole))
                event.accept()
                return

        # Handle Ctrl+C (Copy)
        if event.modifiers() & Qt.ControlModifier and event.key() == Qt.Key_C:
            selected = self.selectedItems()
            if selected and hasattr(parent_explorer, '_copy_selected'):
                paths = [item.data(0, Qt.UserRole) for item in selected]
                parent_explorer._copy_selected(paths)
                event.accept()
                return
                
        # Handle Ctrl+X (Cut)
        if event.modifiers() & Qt.ControlModifier and event.key() == Qt.Key_X:
            selected = self.selectedItems()
            if selected and hasattr(parent_explorer, '_cut_selected'):
                paths = [item.data(0, Qt.UserRole) for item in selected]
                parent_explorer._cut_selected(paths)
                event.accept()
                return
                
        # Handle Ctrl+V (Paste)
        if event.modifiers() & Qt.ControlModifier and event.key() == Qt.Key_V:
            curr = self.currentItem()
            if hasattr(parent_explorer, '_paste_files'):
                target = curr.data(0, Qt.UserRole) if curr else getattr(parent_explorer, '_root_path', None)
                if target:
                    parent_explorer._paste_files(target)
                event.accept()
                return

        super().keyPressEvent(event)

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragEnterEvent(event)
            
    def dragMoveEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragMoveEvent(event)

    def dropEvent(self, event):
        target_item = self.itemAt(event.position().toPoint())
        
        target_path = None
        if target_item:
            target_path = target_item.data(0, Qt.UserRole)
            if target_path and not os.path.isdir(target_path):
                target_path = os.path.dirname(target_path)
        else:
            parent_explorer = self.parent()
            if hasattr(parent_explorer, '_root_path'):
                target_path = parent_explorer._root_path
                
        if not target_path:
            return super().dropEvent(event)

        # Handle External Drop (URLs)
        if event.mimeData().hasUrls():
            moved_any = False
            for url in event.mimeData().urls():
                if url.isLocalFile():
                    source_path = url.toLocalFile()
                    try:
                        dest = os.path.join(target_path, os.path.basename(source_path))
                        if dest == source_path:
                            continue
                            
                        base, ext = os.path.splitext(os.path.basename(source_path))
                        counter = 1
                        while os.path.exists(dest):
                            dest = os.path.join(target_path, f"{base} copy {counter}{ext}" if counter > 1 else f"{base} copy{ext}")
                            counter += 1
                            
                        import shutil
                        if os.path.isdir(source_path):
                            shutil.copytree(source_path, dest)
                        else:
                            shutil.copy2(source_path, dest)
                        moved_any = True
                    except Exception as e:
                        print(f"Error copying external file: {e}")
            if moved_any:
                event.acceptProposedAction()
                return

        # Handle Internal Drop
        selected_items = self.selectedItems()
        if not selected_items:
            return super().dropEvent(event)
            
        moved_any = False
        for source_item in selected_items:
            source_path = source_item.data(0, Qt.UserRole)
            if source_path and source_path != target_path:
                # If Ctrl is pressed, do copy instead of move
                from PySide6.QtWidgets import QApplication
                is_copy = QApplication.keyboardModifiers() & Qt.ControlModifier
                
                if not target_path.startswith(source_path + os.sep):
                    try:
                        dest = os.path.join(target_path, os.path.basename(source_path))
                        if dest == source_path:
                            continue
                            
                        base, ext = os.path.splitext(os.path.basename(source_path))
                        counter = 1
                        while os.path.exists(dest):
                            dest = os.path.join(target_path, f"{base} copy {counter}{ext}" if counter > 1 else f"{base} copy{ext}")
                            counter += 1
                            
                        import shutil
                        if is_copy:
                            if os.path.isdir(source_path):
                                shutil.copytree(source_path, dest)
                            else:
                                shutil.copy2(source_path, dest)
                        else:
                            shutil.move(source_path, dest)
                        moved_any = True
                    except Exception as e:
                        print(f"Error moving/copying file: {e}")
        if moved_any:
            event.accept()
            return
            
        super().dropEvent(event)


class FileExplorer(QWidget):
    file_selected = Signal(str)
    root_changed = Signal(str)
    find_in_folder_requested = Signal(str)
    open_in_terminal_requested = Signal(str)
    open_to_side_requested = Signal(str)
    workspace_toggled = Signal(bool)

    def __init__(self, root_path: str = None, parent=None):
        super().__init__(parent)
        self._root_path = root_path  # Keep None if no folder is open
        self._git_status = {}
        self._git_folders = set()
        self._in_inline_edit = False
        self._editing_item = None
        self._force_expand_root = True  # Flag to force expansion on first load or when root changes
        self._welcome_widget = None
        self._open_editors_panel = None
        self._clipboard = {"action": None, "paths": []}
        self.setObjectName("fileExplorer")

        self._watcher = QFileSystemWatcher(self)
        self._watcher.directoryChanged.connect(self._schedule_refresh)
        
        self._is_refreshing = False
        
        self._watcher_timer = QTimer(self)
        self._watcher_timer.setSingleShot(True)
        self._watcher_timer.setInterval(500)
        self._watcher_timer.timeout.connect(lambda: self._update_watcher(self._get_expanded_paths()))
        
        self._refresh_timer = QTimer(self)
        self._refresh_timer.setSingleShot(True)
        self._refresh_timer.setInterval(200) # debounce
        self._refresh_timer.timeout.connect(self._do_refresh)

        self._setup_ui()

    def setup_explorer_menu(self, open_editors_panel, outline_panel=None, timeline_panel=None):
        self._open_editors_panel = open_editors_panel
        self._outline_panel = outline_panel
        self._timeline_panel = timeline_panel
        
        config = get_config()
        if self._open_editors_panel:
            self._open_editors_panel.setVisible(config.show_open_editors)
        if self._outline_panel:
            self._outline_panel.setVisible(config.show_outline)
        if self._timeline_panel:
            self._timeline_panel.setVisible(config.show_timeline)
        
        folders_visible = config.show_folders
        if not folders_visible:
            self._tree.setVisible(False)
            self._workspace_header.setVisible(False)
            if self._welcome_widget:
                self._welcome_widget.setVisible(False)

    def _show_explorer_menu(self):
        from PySide6.QtWidgets import QMenu
        from PySide6.QtGui import QAction
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
            }
            QMenu::item {
                padding: 4px 24px 4px 24px;
            }
            QMenu::item:selected {
                background-color: #3c0068;
                color: #ffffff;
            }
        """)
        
        config = get_config()
        if self._open_editors_panel:
            toggle_oe = QAction("Open Editors", self)
            toggle_oe.setCheckable(True)
            toggle_oe.setChecked(not self._open_editors_panel.isHidden())
            def _toggle_oe(checked):
                self._open_editors_panel.setVisible(checked)
                config.show_open_editors = checked
                config.save()
            toggle_oe.triggered.connect(_toggle_oe)
            menu.addAction(toggle_oe)
            
        toggle_folders = QAction("Folders", self)
        toggle_folders.setCheckable(True)
        folders_visible = self._tree.isVisible() or self._workspace_header.isVisible() or (self._welcome_widget and self._welcome_widget.isVisible())
        toggle_folders.setChecked(folders_visible)
        def _toggle_folders(checked):
            self._tree.setVisible(checked)
            self._workspace_header.setVisible(checked)
            if self._welcome_widget and not self._root_path:
                self._welcome_widget.setVisible(checked)
            config.show_folders = checked
            config.save()
        toggle_folders.triggered.connect(_toggle_folders)
        menu.addAction(toggle_folders)
        
        if hasattr(self, '_outline_panel') and self._outline_panel:
            toggle_outline = QAction("Outline", self)
            toggle_outline.setCheckable(True)
            toggle_outline.setChecked(not self._outline_panel.isHidden())
            def _toggle_outline(checked):
                self._outline_panel.setVisible(checked)
                config.show_outline = checked
                config.save()
            toggle_outline.triggered.connect(_toggle_outline)
            menu.addAction(toggle_outline)
            
        if hasattr(self, '_timeline_panel') and self._timeline_panel:
            toggle_timeline = QAction("Timeline", self)
            toggle_timeline.setCheckable(True)
            toggle_timeline.setChecked(not self._timeline_panel.isHidden())
            def _toggle_timeline(checked):
                self._timeline_panel.setVisible(checked)
                config.show_timeline = checked
                config.save()
            toggle_timeline.triggered.connect(_toggle_timeline)
            menu.addAction(toggle_timeline)
            
        menu.exec(self.mapToGlobal(self._explorer_menu_btn.pos() + self._explorer_menu_btn.rect().bottomLeft()))

    def add_subpanel(self, panel):
        """Insert a subpanel (like OpenEditors or NpmScripts) right after the main EXPLORER header."""
        idx = self.layout().indexOf(self._welcome_widget)
        if idx >= 0:
            self.layout().insertWidget(idx, panel)
        else:
            self.layout().addWidget(panel)

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
        self._explorer_menu_btn = QPushButton()
        self._explorer_menu_btn.setFixedSize(24, 24)
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        icon_path = os.path.join(base_dir, "image", "more.svg")
        if os.path.exists(icon_path):
            self._explorer_menu_btn.setIcon(QIcon(icon_path))
        else:
            self._explorer_menu_btn.setText("...")
            
        self._explorer_menu_btn.setToolTip("Views and More Actions")
        self._explorer_menu_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #cccccc;
                font-size: 14px;
                font-weight: bold;
                border-radius: 4px;
                padding-bottom: 2px;
            }
            QPushButton:hover {
                background-color: rgba(90, 93, 94, 0.31);
                color: #ffffff;
            }
        """)
        self._explorer_menu_btn.clicked.connect(self._show_explorer_menu)
        header_layout.addWidget(self._explorer_menu_btn)

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

        # Workspace Header
        self._workspace_collapsed = False
        self._workspace_header = SectionHeaderButton("", collapsed=self._workspace_collapsed)
        self._workspace_header.clicked.connect(self._toggle_workspace)
        self._workspace_header.setContextMenuPolicy(Qt.CustomContextMenu)
        self._workspace_header.customContextMenuRequested.connect(self._show_workspace_context_menu)
        
        ws_layout = QHBoxLayout(self._workspace_header)
        ws_layout.setContentsMargins(0, 0, 8, 0)
        ws_layout.setSpacing(4)
        ws_layout.addStretch()
        
        for icon_file, icon_text, tooltip, callback in [
            ("new_file.svg", "+", "New File", lambda: self._new_file_in(self._root_path, None)),
            ("new_folder.svg", "\U0001F4C1", "New Folder", lambda: self._new_folder_in(self._root_path, None)),
            ("refresh.svg", "\u21BB", "Refresh", self._refresh),
            ("collapse.svg", "-", "Collapse All", self.collapse_all),
        ]:
            btn = QPushButton()
            icon_path = os.path.join(base_dir, "image", icon_file)
            if os.path.exists(icon_path):
                btn.setIcon(QIcon(icon_path))
            else:
                btn.setText(icon_text)
                
            btn.setFixedSize(22, 22)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: none;
                    color: #cccccc;
                    font-size: 11px;
                    border-radius: 4px;
                }
                QPushButton:hover {
                    background-color: rgba(90, 93, 94, 0.31);
                    color: #ffffff;
                }
            """)
            btn.clicked.connect(callback)
            ws_layout.addWidget(btn)
            
        self._workspace_header.hide()
        layout.addWidget(self._workspace_header)

        # Tree widget
        self._tree = ExplorerTreeWidget(self)
        self._tree.setStyle(TreeBranchStyle())
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(12)
        self._tree.setAnimated(True)
        self._tree.setExpandsOnDoubleClick(True)
        self._tree.setRootIsDecorated(True)
        self._tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tree.customContextMenuRequested.connect(self._show_context_menu)
        self._tree.header().hide()
        
        # Shortcuts
        from PySide6.QtGui import QShortcut, QKeySequence
        f2_shortcut = QShortcut(QKeySequence("F2"), self._tree)
        f2_shortcut.activated.connect(self._trigger_rename)

        self._tree.itemExpanded.connect(self._on_item_expanded)
        self._tree.itemCollapsed.connect(self._on_item_collapsed)
        self._tree.itemClicked.connect(self._on_item_clicked)
        self._tree.setIconSize(QSize(18, 18))
        
        # Drag and Drop support
        self._tree.setDragEnabled(True)
        self._tree.setAcceptDrops(True)
        self._tree.setDropIndicatorShown(True)
        self._tree.setDragDropMode(QTreeWidget.InternalMove)
        self._tree.setSelectionMode(QTreeWidget.ExtendedSelection)
        self._tree.viewport().setAcceptDrops(True)

        # Set Git status delegate
        self._tree.setItemDelegate(GitStatusDelegate(self._tree))
        self._tree.itemDelegate().closeEditor.connect(self._on_editor_closed)

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
        
        self._tree_container = QWidget()
        self._tree_container.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        tree_layout = QHBoxLayout(self._tree_container)
        tree_layout.setContentsMargins(12, 0, 0, 0)
        tree_layout.addWidget(self._tree)
        layout.addWidget(self._tree_container)
        


        self._tree.itemChanged.connect(self._on_item_changed)
        
        if self._root_path:
            self._welcome_widget.hide()
            self._tree_container.show()
            self._refresh()
        else:
            self._welcome_widget.show()
            self._tree_container.hide()
    def _get_compact_folder(self, base_path: str, base_name: str, exclude_patterns: list):
        current_path = os.path.join(base_path, base_name)
        display_name = base_name
        
        while True:
            try:
                entries = os.listdir(current_path)
            except OSError:
                break
                
            valid_entries = []
            for e in entries:
                should_exclude = False
                for pat in exclude_patterns:
                    if fnmatch.fnmatch(e, pat):
                        should_exclude = True
                        break
                if not should_exclude:
                    valid_entries.append(e)
                    
            if len(valid_entries) == 1:
                child = valid_entries[0]
                child_path = os.path.join(current_path, child)
                if os.path.isdir(child_path):
                    display_name += f"/{child}"
                    current_path = child_path
                else:
                    break
            else:
                break
                
        return display_name, current_path

    def _load_directory(self, path: str, parent_item: QTreeWidgetItem = None):
        # Fetch config for sorting and excludes
        h_config = get_hierarchical_config(self._root_path)
        sort_order = h_config.get("explorer.sortOrder", "default")
        
        try:
            entries = os.listdir(path)
            
            if sort_order == "mixed":
                entries.sort(key=lambda x: x.lower())
            elif sort_order == "filesFirst":
                entries.sort(key=lambda x: (os.path.isdir(os.path.join(path, x)), x.lower()))
            elif sort_order == "type":
                entries.sort(key=lambda x: (not os.path.isdir(os.path.join(path, x)), os.path.splitext(x)[1].lower(), x.lower()))
            elif sort_order == "modified":
                entries.sort(key=lambda x: -os.path.getmtime(os.path.join(path, x)))
            else: # default (folders first)
                entries.sort(key=lambda x: (not os.path.isdir(os.path.join(path, x)), x.lower()))
                
        except (PermissionError, OSError):
            return

        exclude_dict = h_config.get("files.exclude", {
            "**/.git": True,
            "**/__pycache__": True,
            "**/.DS_Store": True
        })
        
        # Parse exclude patterns
        exclude_patterns = []
        for pattern, is_excluded in exclude_dict.items():
            if is_excluded:
                # Basic conversion from glob to fnmatch compatible
                pat = pattern.replace("**/", "*") if pattern.startswith("**/") else pattern
                exclude_patterns.append(pat)
                
        # Do not use .gitignore for hiding files from the explorer anymore.
        # VS Code only grays them out.

        # File Nesting Config
        nesting_enabled = False # Disabled by default as it disrupts sorting and VS Code parity
        nesting_patterns = {}

        valid_names = []
        for name in entries:
            should_exclude = any(fnmatch.fnmatch(name, pat) for pat in exclude_patterns)
            if not should_exclude:
                valid_names.append(name)

        nested_under = {} # child -> parent
        if nesting_enabled:
            for p_name in valid_names:
                if os.path.isdir(os.path.join(path, p_name)): continue
                for pat, children_str in nesting_patterns.items():
                    if fnmatch.fnmatch(p_name, pat):
                        capture = p_name
                        if pat.startswith("*"):
                            ext = pat[1:]
                            if p_name.endswith(ext):
                                capture = p_name[:-len(ext)]
                        
                        child_pats = [c.strip() for c in children_str.split(",")]
                        for c_pat in child_pats:
                            c_pat_real = c_pat.replace("${capture}", capture)
                            for c_name in valid_names:
                                if c_name != p_name and c_name not in nested_under and not os.path.isdir(os.path.join(path, c_name)):
                                    if fnmatch.fnmatch(c_name, c_pat_real):
                                        nested_under[c_name] = p_name

        added_any = False
        item_map = {}
        for name in valid_names:
            added_any = True

            added_any = True
            full_path = os.path.join(path, name)
            
            is_dir = os.path.isdir(full_path)
            display_name = name
            
            if is_dir:
                display_name, full_path = self._get_compact_folder(path, name, exclude_patterns)
                
            item = QTreeWidgetItem()
            item.setText(0, display_name)
            item.setData(0, Qt.UserRole, full_path)
            item.setToolTip(0, full_path)

            # Git Status coloring
            try:
                rel_path = os.path.relpath(full_path, self._root_path)
                rel_path_norm = rel_path.replace("/", os.sep).replace("\\", os.sep)
            except Exception:
                rel_path_norm = ""

            if is_dir:
                # Use the last part of the compact path for icon detection (if we want, or just default folder)
                item.setIcon(0, get_folder_icon(display_name.split('/')[-1], False))
                item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                item.setData(0, Qt.UserRole + 4, False) # loaded flag
                
                # Color folder if it has changes inside
                if rel_path_norm in self._git_folders:
                    item.setForeground(0, QColor("#e2c08d"))
                    item.setData(0, Qt.UserRole + 3, "●")
                    
            else:
                item.setIcon(0, get_file_icon(full_path))
                
                # Color file based on its git status
                if rel_path_norm in self._git_status:
                    status = self._git_status[rel_path_norm]
                    item.setData(0, Qt.UserRole + 3, status)
                    if status == "M":
                        item.setForeground(0, QColor("#e2c08d"))  # Yellow for modified
                    elif status in ("A", "U"):
                        item.setForeground(0, QColor("#73c991"))  # Green for added/untracked
                    elif status == "D":
                        item.setForeground(0, QColor("#e51400"))  # Red for deleted

            # Visual dimming if item is cut
            if self._clipboard.get("action") == "cut" and full_path in self._clipboard.get("paths", []):
                item.setForeground(0, QColor(200, 200, 200, 100)) # Dimmed color

            item_map[name] = item

        for name, item in item_map.items():
            if name in nested_under:
                parent_name = nested_under[name]
                if parent_name in item_map:
                    item_map[parent_name].addChild(item)
                    item_map[parent_name].setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                else:
                    if parent_item: parent_item.addChild(item)
                    else: self._tree.addTopLevelItem(item)
            else:
                if parent_item: parent_item.addChild(item)
                else: self._tree.addTopLevelItem(item)

    def _toggle_workspace(self):
        self._workspace_collapsed = not getattr(self, '_workspace_collapsed', False)
        self._workspace_header.set_collapsed(self._workspace_collapsed)
        if hasattr(self, '_tree_container'):
            self._tree_container.setVisible(not self._workspace_collapsed)
        self.workspace_toggled.emit(self._workspace_collapsed)

    def _on_item_expanded(self, item: QTreeWidgetItem):
        path = item.data(0, Qt.UserRole)
        is_loaded = item.data(0, Qt.UserRole + 4)
        if path and os.path.isdir(path):
            item.setIcon(0, get_folder_icon(item.text(0), True))
            
            if not is_loaded:
                self._load_directory(path, item)
                item.setData(0, Qt.UserRole + 4, True)
                
            # If truly empty, collapse it immediately so it doesn't enter the bugged Qt state where the chevron vanishes!
            if item.childCount() == 0:
                # Prevent expanding empty folders to keep the chevron visible
                QTimer.singleShot(0, lambda: self._tree.collapseItem(item))
                
            if not getattr(self, '_is_refreshing', False):
                self._watcher_timer.start()

    def _on_item_collapsed(self, item: QTreeWidgetItem):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isdir(path):
            item.setIcon(0, get_folder_icon(item.text(0), False))
            if not getattr(self, '_is_refreshing', False):
                self._watcher_timer.start()

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
        if not self._root_path: return
        cwd = self._root_path if os.path.isdir(self._root_path) else os.path.dirname(self._root_path)
        if not os.path.exists(os.path.join(cwd, ".git")):
            return

        import threading
        def worker():
            try:
                import subprocess
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                
                result = subprocess.run(
                    ["git", "status", "--porcelain", "-u"],
                    cwd=cwd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=3,
                    **kwargs
                )
                if result.returncode != 0:
                    return
                
                status_dict = {}
                folders_set = set()
                for line in result.stdout.splitlines():
                    if len(line) < 3: continue
                    xy = line[:2]
                    path = line[3:].strip().replace("/", os.sep)
                    if '?' in xy: status = 'U'
                    elif 'D' in xy: status = 'D'
                    elif 'A' in xy: status = 'A'
                    else: status = 'M'
                    status_dict[path] = status
                    
                    parent = os.path.dirname(path)
                    while parent:
                        folders_set.add(parent)
                        parent = os.path.dirname(parent)
                        
                from PySide6.QtCore import QTimer
                QTimer.singleShot(0, lambda: self._apply_git_status(status_dict, folders_set))
            except Exception as e:
                pass
                
        threading.Thread(target=worker, daemon=True).start()

    def _apply_git_status(self, status_dict, folders_set):
        self._git_status = status_dict
        self._git_folders = folders_set
        
        def traverse_and_color(item):
            path = item.data(0, Qt.UserRole)
            if path:
                try:
                    rel_path = os.path.relpath(path, self._root_path)
                    rel_path_norm = rel_path.replace("/", os.sep).replace("\\", os.sep)
                except Exception:
                    rel_path_norm = ""
                    
                is_dir = os.path.isdir(path)
                
                item.setForeground(0, QColor("#cccccc"))
                item.setData(0, Qt.UserRole + 3, None)
                
                if is_dir:
                    if rel_path_norm in self._git_folders:
                        item.setForeground(0, QColor("#e2c08d"))
                        item.setData(0, Qt.UserRole + 3, "●")
                else:
                    if rel_path_norm in self._git_status:
                        status = self._git_status[rel_path_norm]
                        item.setData(0, Qt.UserRole + 3, status)
                        if status == "M":
                            item.setForeground(0, QColor("#e2c08d"))
                        elif status in ("A", "U"):
                            item.setForeground(0, QColor("#73c991"))
                        elif status == "D":
                            item.setForeground(0, QColor("#e51400"))
                            
                if self._clipboard.get("action") == "cut" and path in self._clipboard.get("paths", []):
                    item.setForeground(0, QColor(200, 200, 200, 100))
                    
            for i in range(item.childCount()):
                traverse_and_color(item.child(i))

        for i in range(self._tree.topLevelItemCount()):
            traverse_and_color(self._tree.topLevelItem(i))

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

    def _schedule_refresh(self, path=None):
        if not self._editing_item:
            self._refresh_timer.start()

    def _refresh(self):
        self._do_refresh()

    def _do_refresh(self):
        if self._editing_item:
            return

        if not self._root_path:
            self._welcome_widget.show()
            self._tree.hide()
            return

        self._welcome_widget.hide()
        
        is_workspace_file = self._root_path.endswith(".code-workspace") and os.path.isfile(self._root_path)
        if is_workspace_file:
            self._workspace_header.setText("WORKSPACE")
        else:
            self._workspace_header.setText(os.path.basename(self._root_path))
            
        self._workspace_header.show()
        
        if not getattr(self, '_workspace_collapsed', False):
            self._tree.show()
            if hasattr(self, '_tree_container'):
                self._tree_container.show()
            if hasattr(self, '_bottom_spacer'):
                self._bottom_spacer.hide()
        else:
            self._tree.hide()
            if hasattr(self, '_tree_container'):
                self._tree_container.hide()
            if hasattr(self, '_bottom_spacer'):
                self._bottom_spacer.show()

        self._is_refreshing = True
        self._tree.setUpdatesEnabled(False)
        self._tree.blockSignals(True)
        try:
            # Save active expansion states
            expanded = self._get_expanded_paths()
            
            self._tree.clear()
            self._refresh_git_status()
            
            if is_workspace_file:
                try:
                    import json
                    with open(self._root_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    folders = data.get("folders", [])
                    base_dir = os.path.dirname(self._root_path)
                    
                    for folder in folders:
                        path_ref = folder.get("path")
                        if not path_ref: continue
                        
                        full_path = os.path.normpath(os.path.join(base_dir, path_ref))
                        if os.path.isdir(full_path):
                            # Create a top-level item for this root
                            root_item = QTreeWidgetItem()
                            root_item.setText(0, os.path.basename(full_path))
                            root_item.setData(0, Qt.UserRole, full_path)
                            root_item.setIcon(0, get_folder_icon(root_item.text(0), False))
                            self._tree.addTopLevelItem(root_item)
                            
                            self._load_directory(full_path, root_item)
                except Exception as e:
                    print(f"Error loading workspace: {e}")
            else:
                # Load directory directly as top-level items
                self._load_directory(self._root_path, None)
            
            if self._force_expand_root:
                self._workspace_collapsed = False
                self._workspace_header.set_collapsed(False)
                self._tree.show()
                self.workspace_toggled.emit(False)
                if hasattr(self, '_bottom_spacer'):
                    self._bottom_spacer.hide()
                
            self._force_expand_root = False  # Reset force flag
            
            # Unblock signals before restoring so itemExpanded is emitted!
            self._tree.blockSignals(False)
            
            # Restore other expansion states
            self._restore_expanded_paths(expanded)
        finally:
            # We already unblocked above, but just in case of exception:
            self._tree.blockSignals(False)
            self._tree.setUpdatesEnabled(True)
            self._is_refreshing = False
            self._watcher_timer.start()

    def _update_watcher(self, expanded_paths):
        # Clear existing paths
        current_paths = self._watcher.directories()
        if current_paths:
            self._watcher.removePaths(current_paths)
            
        # Add root and expanded paths
        if self._root_path and os.path.exists(self._root_path):
            paths_to_watch = {self._root_path}
            for p in expanded_paths:
                if os.path.exists(p):
                    paths_to_watch.add(p)
            
            if paths_to_watch:
                self._watcher.addPaths(list(paths_to_watch))

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

    def _show_workspace_context_menu(self, position):
        if not self._root_path:
            return

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

        new_file = QAction("New File...", self)
        new_file.triggered.connect(lambda: self._new_file_in(self._root_path, None))
        menu.addAction(new_file)

        new_folder = QAction("New Folder...", self)
        new_folder.triggered.connect(lambda: self._new_folder_in(self._root_path, None))
        menu.addAction(new_folder)
        
        menu.addSeparator()

        copy_path = QAction("Copy Path", self)
        from PySide6.QtWidgets import QApplication
        copy_path.triggered.connect(lambda: QApplication.clipboard().setText(os.path.normpath(self._root_path)))
        menu.addAction(copy_path)

        open_explorer = QAction("Reveal in File Explorer", self)
        open_explorer.triggered.connect(lambda: self._reveal_in_explorer(self._root_path))
        menu.addAction(open_explorer)

        menu.exec(self._workspace_header.mapToGlobal(position))

    def _reveal_in_explorer(self, path: str):
        import subprocess, sys
        if not path or not os.path.exists(path):
            return
        if os.name == 'nt':
            subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', '-R', path])
        else:
            subprocess.Popen(['xdg-open', os.path.dirname(path)])

    def reveal_and_select_file(self, target_path: str):
        if not target_path or not self._root_path:
            return
            
        target_path = os.path.normpath(target_path)
        
        def find_item(parent_item):
            for i in range(parent_item.childCount()):
                child = parent_item.child(i)
                item_path = child.data(0, Qt.UserRole)
                if not item_path:
                    continue
                item_path = os.path.normpath(item_path)
                
                if item_path == target_path:
                    return child
                elif target_path.startswith(item_path + os.sep):
                    if not child.isExpanded():
                        child.setExpanded(True)
                        if child.childCount() == 1 and child.child(0).text(0) == "Loading...":
                            self._load_directory(item_path, child)
                    found = find_item(child)
                    if found: return found
            return None

        for i in range(self._tree.topLevelItemCount()):
            top_item = self._tree.topLevelItem(i)
            item_path = top_item.data(0, Qt.UserRole)
            if not item_path: continue
            item_path = os.path.normpath(item_path)
            
            if item_path == target_path:
                self._tree.setCurrentItem(top_item)
                self._tree.scrollToItem(top_item)
                return
            elif target_path.startswith(item_path + os.sep):
                if not top_item.isExpanded():
                    top_item.setExpanded(True)
                    if top_item.childCount() == 1 and top_item.child(0).text(0) == "Loading...":
                        self._load_directory(item_path, top_item)
                found = find_item(top_item)
                if found:
                    self._tree.setCurrentItem(found)
                    self._tree.scrollToItem(found)
                    return

    def _show_context_menu(self, position):
        self._refresh_timer.stop()
        self._in_inline_edit = True
        
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
            
            self._in_inline_edit = False
            self._schedule_refresh()
            return

        path = item.data(0, Qt.UserRole)
        if not path:
            self._in_inline_edit = False
            self._schedule_refresh()
            return

        is_root = (path == self._root_path)

        if os.path.isfile(path):
            open_action = QAction("Open", self)
            open_action.triggered.connect(lambda: self.file_selected.emit(path))
            menu.addAction(open_action)
            open_side_action = QAction("Open to the Side", self)
            open_side_action.triggered.connect(lambda: self.open_to_side_requested.emit(path))
            menu.addAction(open_side_action)
            menu.addSeparator()
            reveal_action = QAction("Reveal in File Explorer", self)
            reveal_action.triggered.connect(lambda: self._reveal_in_explorer(path))
            menu.addAction(reveal_action)
            menu.addSeparator()

        if os.path.isdir(path):
            new_file = QAction("New File...", self)
            new_file.triggered.connect(lambda: self._new_file_in(path, item))
            menu.addAction(new_file)
            new_folder = QAction("New Folder...", self)
            new_folder.triggered.connect(lambda: self._new_folder_in(path, item))
            menu.addAction(new_folder)
            menu.addSeparator()
            find_folder = QAction("Find in Folder...", self)
            find_folder.triggered.connect(lambda: self.find_in_folder_requested.emit(path))
            menu.addAction(find_folder)
            open_term = QAction("Open in Integrated Terminal", self)
            open_term.triggered.connect(lambda: self.open_in_terminal_requested.emit(path))
            menu.addAction(open_term)
            reveal_dir_action = QAction("Reveal in File Explorer", self)
            reveal_dir_action.triggered.connect(lambda: self._reveal_in_explorer(path))
            menu.addAction(reveal_dir_action)
            menu.addSeparator()

        if not is_root:
            cut_action = QAction("Cut", self)
            cut_action.triggered.connect(lambda: self._cut_selected([item.data(0, Qt.UserRole) for item in self._tree.selectedItems()]))
            menu.addAction(cut_action)
            copy_action = QAction("Copy", self)
            copy_action.triggered.connect(lambda: self._copy_selected([item.data(0, Qt.UserRole) for item in self._tree.selectedItems()]))
            menu.addAction(copy_action)
            paste_action = QAction("Paste", self)
            paste_action.triggered.connect(lambda: self._paste_files(path))
            paste_action.setEnabled(bool(self._clipboard["paths"]))
            menu.addAction(paste_action)
            menu.addSeparator()

            rename_action = QAction("Rename...", self)
            rename_action.triggered.connect(lambda: self._rename_item(item, path))
            menu.addAction(rename_action)

            delete_action = QAction("Delete", self)
            delete_action.triggered.connect(lambda: self._delete_items([item.data(0, Qt.UserRole) for item in self._tree.selectedItems()]))
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
        
        self._in_inline_edit = False
        self._schedule_refresh()

    def _copy_path(self, path: str):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(path)

    def _copy_relative_path(self, path: str):
        if not self._root_path: return
        rel = os.path.relpath(path, self._root_path)
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(rel)
        
    def _trigger_rename(self):
        item = self._tree.currentItem()
        if item:
            path = item.data(0, Qt.UserRole)
            if path:
                self._rename_item(item, path)

    def _rename_item(self, item: QTreeWidgetItem, path: str):
        # Store temporary data for the rename operation
        item.setData(0, Qt.UserRole + 1, "rename")
        item.setData(0, Qt.UserRole + 2, path)
        
        # Make the item editable and trigger editing
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)
        
        # Smart Selection: Select only filename, not extension
        def select_filename_only():
            from PySide6.QtWidgets import QLineEdit
            for child in self._tree.children():
                if isinstance(child, QLineEdit):
                    text = child.text()
                    if '.' in text and not os.path.isdir(path):
                        # Don't select the extension
                        name_len = len(text) - len(text.split('.')[-1]) - 1
                        if name_len > 0:
                            child.setSelection(0, name_len)
                    break
        from PySide6.QtCore import QTimer
        QTimer.singleShot(10, select_filename_only)

    def _delete_item(self, path: str):
        self._delete_items([path])

    def _delete_items(self, paths: list):
        if not paths:
            return
            
        msg_box = QMessageBox(self)
        msg_box.setWindowTitle("Confirm Delete")
        msg_box.setText(f"Are you sure you want to delete {len(paths)} item(s)?")
        msg_box.setIcon(QMessageBox.Question)
        
        try:
            import send2trash
            has_trash = True
        except ImportError:
            has_trash = False

        if has_trash:
            trash_btn = msg_box.addButton("Move to Trash", QMessageBox.AcceptRole)
        perm_btn = msg_box.addButton("Delete Permanently", QMessageBox.DestructiveRole)
        cancel_btn = msg_box.addButton("Cancel", QMessageBox.RejectRole)
        
        msg_box.exec()
        
        clicked = msg_box.clickedButton()
        if clicked == cancel_btn:
            return
            
        use_trash = has_trash and (clicked == trash_btn)
        
        try:
            for path in paths:
                if use_trash:
                    import send2trash
                    send2trash.send2trash(os.path.normpath(path))
                else:
                    if os.path.isdir(path):
                        import shutil
                        shutil.rmtree(path)
                    else:
                        os.remove(path)
            self._refresh()
        except Exception as e:
            QMessageBox.warning(self, "Error", str(e))

    def _copy_selected(self, paths: list):
        self._clipboard = {"action": "copy", "paths": paths}
        self._refresh()

    def _cut_selected(self, paths: list):
        self._clipboard = {"action": "cut", "paths": paths}
        self._refresh()

    def _paste_files(self, target_dir: str):
        if not target_dir or not os.path.isdir(target_dir):
            target_dir = os.path.dirname(target_dir) if target_dir else getattr(self, '_root_path', None)
            if not target_dir: return

        if not self._clipboard["paths"]:
            return

        action = self._clipboard["action"]
        paths = self._clipboard["paths"]
        moved_any = False
        try:
            import shutil
            for source_path in paths:
                if not os.path.exists(source_path):
                    continue
                
                dest = os.path.join(target_dir, os.path.basename(source_path))
                if dest == source_path:
                    continue
                
                base, ext = os.path.splitext(os.path.basename(source_path))
                counter = 1
                while os.path.exists(dest):
                    dest = os.path.join(target_dir, f"{base} copy {counter}{ext}" if counter > 1 else f"{base} copy{ext}")
                    counter += 1
                
                if action == "copy":
                    if os.path.isdir(source_path):
                        shutil.copytree(source_path, dest)
                    else:
                        shutil.copy2(source_path, dest)
                    moved_any = True
                elif action == "cut":
                    shutil.move(source_path, dest)
                    moved_any = True
            
            if action == "cut" and moved_any:
                self._clipboard = {"action": None, "paths": []}
                
        except Exception as e:
            print(f"Error pasting files: {e}")

    def collapse_all(self):
        self._tree.collapseAll()

    def _new_file(self):
        curr = self._tree.currentItem()
        if curr:
            path = curr.data(0, Qt.UserRole)
            if path:
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
            if path:
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
        if self._editing_item:
            return
        d = parent_path if os.path.isdir(parent_path) else os.path.dirname(parent_path)
        
        item = QTreeWidgetItem()
        item.setText(0, "")
        item.setIcon(0, get_file_icon(""))
        
        # Operation meta info
        item.setData(0, Qt.UserRole + 1, "create_file")
        item.setData(0, Qt.UserRole + 2, d)
        
        self._tree.blockSignals(True)
        if parent_item:
            self._tree.expandItem(parent_item)
            parent_item.insertChild(0, item)
        else:
            self._tree.insertTopLevelItem(0, item)
            
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.blockSignals(False)
        self._editing_item = item
        self._refresh_timer.stop()
        
        def start_edit():
            self._tree.scrollToItem(item)
            self._tree.setCurrentItem(item)
            self._tree.setFocus()
            self._tree.editItem(item, 0)
            
        QTimer.singleShot(10, start_edit)

    def _new_folder_in(self, parent_path: str, parent_item: QTreeWidgetItem = None):
        if self._editing_item:
            return
        d = parent_path if os.path.isdir(parent_path) else os.path.dirname(parent_path)
        
        item = QTreeWidgetItem()
        item.setText(0, "")
        item.setIcon(0, get_folder_icon("", False))
        
        # Operation meta info
        item.setData(0, Qt.UserRole + 1, "create_folder")
        item.setData(0, Qt.UserRole + 2, d)
        
        self._tree.blockSignals(True)
        if parent_item:
            self._tree.expandItem(parent_item)
            parent_item.insertChild(0, item)
        else:
            self._tree.insertTopLevelItem(0, item)
            
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.blockSignals(False)
        self._editing_item = item
        self._refresh_timer.stop()
        
        def start_edit():
            self._tree.scrollToItem(item)
            self._tree.setCurrentItem(item)
            self._tree.setFocus()
            self._tree.editItem(item, 0)
            
        QTimer.singleShot(10, start_edit)

    def _on_editor_closed(self, editor, hint=None):
        item = self._editing_item
        self._editing_item = None
        
        if item:
            op = item.data(0, Qt.UserRole + 1)
            if op in ("create_file", "create_folder") and not item.text(0).strip():
                parent = item.parent()
                if parent:
                    parent.removeChild(item)
                else:
                    self._tree.takeTopLevelItem(self._tree.indexOfTopLevelItem(item))

    def _on_item_changed(self, item: QTreeWidgetItem, column: int):
        if self._in_inline_edit:
            return

        operation = item.data(0, Qt.UserRole + 1)
        if not operation:
            return

        new_name = item.text(0).strip()
        
        # Revert editable flag and clear operations metadata immediately
        self._tree.blockSignals(True)
        item.setFlags(item.flags() & ~Qt.ItemIsEditable)
        item.setData(0, Qt.UserRole + 1, None)
        self._tree.blockSignals(False)
        
        if not new_name:
            if operation in ("create_file", "create_folder"):
                parent = item.parent()
                if parent:
                    parent.removeChild(item)
                else:
                    self._tree.takeTopLevelItem(self._tree.indexOfTopLevelItem(item))
            elif operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                item.setText(0, os.path.basename(old_path))
            
            self._in_inline_edit = False
            return

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
                item.setData(0, Qt.UserRole + 4, False) # loaded flag
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
            if hasattr(self, '_tree_container'):
                self._tree_container.show()
            if hasattr(self, '_bottom_spacer'):
                self._bottom_spacer.hide()
            self._refresh()
        else:
            self._welcome_widget.show()
            self._tree.hide()
            if hasattr(self, '_tree_container'):
                self._tree_container.hide()
            if hasattr(self, '_bottom_spacer'):
                self._bottom_spacer.show()

    def get_root(self) -> str:
        return self._root_path

    def is_empty(self) -> bool:
        return self._root_path is None
