"""Text-to-Speech (TTS) Subsystem - Audio synthesis for editor accessibility cues."""

import threading
from PySide6.QtCore import QObject

class TTSService(QObject):
    """Asynchronous speech synthesizer for accessible reading of lines/cues."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._engine = None
        self._lock = threading.Lock()
        
        # Initialize pyttsx3 in a background thread to prevent COM issues on Windows
        threading.Thread(target=self._init_engine, daemon=True).start()

    def _init_engine(self):
        with self._lock:
            try:
                import pyttsx3
                self._engine = pyttsx3.init()
                # Set default rates
                self._engine.setProperty('rate', 150)
                self._engine.setProperty('volume', 0.9)
            except Exception:
                self._engine = None

    def speak(self, text: str):
        """Speak the given text asynchronously."""
        if not text:
            return
            
        def _speak_task():
            with self._lock:
                if self._engine:
                    try:
                        self._engine.say(text)
                        self._engine.runAndWait()
                    except Exception:
                        pass
                else:
                    # System command fallback for Windows (SAPI.SpVoice)
                    import os
                    if os.name == 'nt':
                        try:
                            # Use PowerShell speech synthesis command as standard Windows fallback
                            cmd = f'PowerShell -Command "Add-Type –AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(\'{text}\')"'
                            import subprocess
                            subprocess.run(cmd, shell=True, creationflags=0x08000000)
                        except Exception:
                            pass
                            
        threading.Thread(target=_speak_task, daemon=True).start()

    def set_rate(self, rate: int):
        with self._lock:
            if self._engine:
                try:
                    self._engine.setProperty('rate', rate)
                except Exception:
                    pass

    def set_volume(self, volume: float):
        with self._lock:
            if self._engine:
                try:
                    self._engine.setProperty('volume', max(0.0, min(1.0, volume)))
                except Exception:
                    pass
