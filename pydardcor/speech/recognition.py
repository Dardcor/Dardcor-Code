"""Speech Recognition Subsystem - Dictation / Speech-to-Text capability for editor input."""

import threading
from PySide6.QtCore import QObject, Signal

class SpeechRecognizer(QObject):
    """Asynchronous speech recognizer for editor dictation."""
    
    text_recognized = Signal(str)
    status_changed = Signal(str)  # "idle", "listening", "processing", "error"

    def __init__(self, parent=None):
        super().__init__(parent)
        self._is_listening = False
        self._thread = None

    def start_listening(self):
        if self._is_listening:
            return
        
        self._is_listening = True
        self.status_changed.emit("listening")
        
        # Run speech recognition in a background thread to prevent UI freezing
        self._thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._thread.start()

    def stop_listening(self):
        self._is_listening = False
        self.status_changed.emit("idle")

    def _listen_loop(self):
        try:
            # Dynamically import speech_recognition package if available
            import speech_recognition as sr
            recognizer = sr.Recognizer()
            microphone = sr.Microphone()
            
            with microphone as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.5)
                while self._is_listening:
                    try:
                        self.status_changed.emit("listening")
                        audio = recognizer.listen(source, timeout=3, phrase_time_limit=10)
                        self.status_changed.emit("processing")
                        
                        # Recognize speech using free Google Speech Recognition API
                        text = recognizer.recognize_google(audio)
                        if text:
                            self.text_recognized.emit(text)
                    except sr.WaitTimeoutError:
                        continue
                    except sr.UnknownValueError:
                        # Speech was unintelligible
                        continue
                    except Exception as e:
                        self.status_changed.emit("error")
                        break
        except ImportError:
            # Fallback/Mock dictation simulation if speech_recognition package is not installed
            import time
            time.sleep(1.5)
            if self._is_listening:
                self.text_recognized.emit("Hello, this is a spoken dictation test from Dardcor Code.")
                self.status_changed.emit("idle")
                self._is_listening = False
