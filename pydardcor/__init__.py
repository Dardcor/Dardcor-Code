"""Dardcor Code - Full Desktop AI Coding Assistant"""

__version__ = "1.0.0"
__author__ = "Dardcor Team"
__license__ = "MIT"

# Monkeypatch QMetaObject.invokeMethod for PySide6 compatibility with callables
import sys
try:
    import PySide6.QtCore
    
    # Define the patched function
    def _patched_invokeMethod(obj, member, *args, **kwargs):
        if callable(member):
            from PySide6.QtCore import Qt, QThread, QCoreApplication, QTimer
            import threading
            
            connection_type = Qt.BlockingQueuedConnection
            remaining_args = []
            for arg in args:
                if isinstance(arg, Qt.ConnectionType):
                    connection_type = arg
                else:
                    remaining_args.append(arg)
            
            app = QCoreApplication.instance()
            if app is None or QThread.currentThread() == app.thread():
                return member(*remaining_args, **kwargs)
            
            result_holder = [None]
            exception_holder = [None]
            event = threading.Event()
            
            def run_in_main_thread():
                try:
                    result_holder[0] = member(*remaining_args, **kwargs)
                except Exception as e:
                    exception_holder[0] = e
                finally:
                    event.set()
            
            QTimer.singleShot(0, run_in_main_thread)
            
            if connection_type == Qt.BlockingQueuedConnection:
                event.wait()
                if exception_holder[0] is not None:
                    raise exception_holder[0]
                return result_holder[0]
            return True
            
        # Fallback to original invokeMethod
        orig = getattr(PySide6.QtCore.QMetaObject, "_original_invokeMethod", None)
        if orig is None:
            orig = original_QMetaObject.invokeMethod
        return orig(obj, member, *args, **kwargs)

    # Save original class and method
    original_QMetaObject = PySide6.QtCore.QMetaObject
    original_invokeMethod = PySide6.QtCore.QMetaObject.invokeMethod

    if not hasattr(original_QMetaObject, "_original_invokeMethod"):
        original_QMetaObject._original_invokeMethod = original_invokeMethod

    # Create PatchedQMetaObject class
    class PatchedQMetaObject(original_QMetaObject):
        @staticmethod
        def invokeMethod(obj, member, *args, **kwargs):
            return _patched_invokeMethod(obj, member, *args, **kwargs)

    # Replace in PySide6.QtCore
    PySide6.QtCore.QMetaObject = PatchedQMetaObject

    # Replace in all loaded modules
    for mod_name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        try:
            if 'QMetaObject' in mod.__dict__:
                mod.__dict__['QMetaObject'] = PatchedQMetaObject
            for k, v in list(mod.__dict__.items()):
                if v is original_invokeMethod:
                    mod.__dict__[k] = _patched_invokeMethod
        except Exception:
            pass
except Exception:
    pass
