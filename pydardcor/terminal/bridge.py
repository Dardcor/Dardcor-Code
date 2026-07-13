from PySide6.QtCore import QObject, Slot, Signal, Property


class TerminalBridge(QObject):
    data_from_frontend = Signal(str)
    resize_requested = Signal(int, int)
    selection_changed = Signal(str)
    bell_ringed = Signal()
    title_changed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._copy_on_select = False

    @Slot(str)
    def receive_data(self, data):
        self.data_from_frontend.emit(data)

    @Slot(int, int)
    def resize_pty(self, cols, rows):
        self.resize_requested.emit(cols, rows)

    @Slot(str)
    def copy_to_clipboard(self, text):
        from PySide6.QtWidgets import QApplication
        clipboard = QApplication.clipboard()
        clipboard.setText(text)

    @Slot()
    def request_paste(self):
        from PySide6.QtWidgets import QApplication
        clipboard = QApplication.clipboard()
        text = clipboard.text()
        if text:
            self.data_from_frontend.emit(text)

    @Slot(str)
    def on_selection_change(self, text):
        self.selection_changed.emit(text)
        if self._copy_on_select and text:
            self.copy_to_clipboard(text)

    @Slot()
    def on_bell(self):
        self.bell_ringed.emit()

    @Slot(str)
    def on_title_change(self, title):
        self.title_changed.emit(title)

    @Slot(bool)
    def set_copy_on_select(self, enabled):
        self._copy_on_select = enabled

    @Slot(result=bool)
    def get_copy_on_select(self):
        return self._copy_on_select
