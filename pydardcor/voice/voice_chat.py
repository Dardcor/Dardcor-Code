"""Voice Chat Integration — voice input/output for AI chat."""

from __future__ import annotations

import os
import threading
from PySide6.QtCore import QObject, Signal, QThread, QCoreApplication
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QPushButton, QHBoxLayout
from PySide6.QtGui import QFont


class VoiceChatController(QObject):
    """Controls voice input and output for the chat panel."""

    voice_text_received = Signal(str)
    status_changed = Signal(str)
    listening_changed = Signal(bool)
    tts_requested = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._is_listening = False
        self._recognizer = None
        self._tts_engine = None

    def start_listening(self):
        if self._is_listening:
            return
        self._is_listening = True
        self.listening_changed.emit(True)
        self.status_changed.emit("listening")
        threading.Thread(target=self._listen_loop, daemon=True).start()

    def stop_listening(self):
        self._is_listening = False
        self.listening_changed.emit(False)
        self.status_changed.emit("idle")

    def _listen_loop(self):
        try:
            import speech_recognition as sr
            self._recognizer = sr.Recognizer()
            mic = sr.Microphone()
            with mic as source:
                self._recognizer.adjust_for_ambient_noise(source, duration=0.3)
                if not self._is_listening:
                    return
                self.status_changed.emit("listening")
                audio = self._recognizer.listen(source, timeout=5, phrase_time_limit=15)
                if not self._is_listening:
                    return
                self.status_changed.emit("processing")
                text = self._recognizer.recognize_google(audio)
                if text:
                    self.voice_text_received.emit(text)
        except ImportError:
            import time
            time.sleep(1)
            if self._is_listening:
                self.voice_text_received.emit("Voice input enabled. Type your message below.")
        except sr.WaitTimeoutError:
            pass
        except sr.UnknownValueError:
            self.status_changed.emit("error")
        except Exception:
            self.status_changed.emit("error")
        finally:
            self._is_listening = False
            self.listening_changed.emit(False)
            self.status_changed.emit("idle")

    def speak(self, text: str):
        """Speak text using TTS."""
        self.tts_requested.emit(text)
        threading.Thread(target=self._speak_impl, args=(text,), daemon=True).start()

    def _speak_impl(self, text: str):
        try:
            import pyttsx3
            if self._tts_engine is None:
                self._tts_engine = pyttsx3.init()
            self._tts_engine.say(text)
            self._tts_engine.runAndWait()
        except Exception:
            if os.name == 'nt':
                import subprocess
                try:
                    safe_text = text.replace("'", "''")
                    cmd = f'PowerShell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(\'{safe_text}\')"'
                    subprocess.run(cmd, shell=True, creationflags=0x08000000, timeout=30)
                except Exception:
                    pass


class VoiceButtonWidget(QWidget):
    """Circular microphone button with status indicator."""

    def __init__(self, controller: VoiceChatController, parent=None):
        super().__init__(parent)
        self._controller = controller
        self._is_listening = False
        self.setFixedSize(36, 36)
        self.setCursor(0)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self._btn = QPushButton("🎤")
        self._btn.setFixedSize(36, 36)
        self._btn.setStyleSheet("""
            QPushButton {
                background-color: #2c004a;
                border: 1px solid #3c0068;
                border-radius: 18px;
                font-size: 16px;
            }
            QPushButton:hover {
                background-color: #3c0068;
                border-color: #a855f7;
            }
            QPushButton:pressed {
                background-color: #4a0072;
            }
        """)
        self._btn.clicked.connect(self._toggle)
        layout.addWidget(self._btn)

        self._status_lbl = QLabel("")
        self._status_lbl.setFixedHeight(12)
        self._status_lbl.setStyleSheet("color: #6b6b8a; font-size: 8px; border: none; text-align: center;")
        layout.addWidget(self._status_lbl)

        self._controller.listening_changed.connect(self._on_listening_changed)
        self._controller.status_changed.connect(self._on_status_changed)

    def _toggle(self):
        if self._is_listening:
            self._controller.stop_listening()
        else:
            self._controller.start_listening()

    def _on_listening_changed(self, listening: bool):
        self._is_listening = listening
        if listening:
            self._btn.setStyleSheet("""
                QPushButton {
                    background-color: #7c3aed;
                    border: 2px solid #a855f7;
                    border-radius: 18px;
                    font-size: 16px;
                }
                QPushButton:hover {
                    background-color: #6d28d9;
                }
            """)
        else:
            self._btn.setStyleSheet("""
                QPushButton {
                    background-color: #2c004a;
                    border: 1px solid #3c0068;
                    border-radius: 18px;
                    font-size: 16px;
                }
                QPushButton:hover {
                    background-color: #3c0068;
                    border-color: #a855f7;
                }
            """)

    def _on_status_changed(self, status: str):
        labels = {
            "idle": "",
            "listening": "Listening...",
            "processing": "Transcribing...",
            "error": "Error",
        }
        self._status_lbl.setText(labels.get(status, status))
