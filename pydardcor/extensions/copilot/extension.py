import json, os

def activate(api):
    api.register_command("copilot.hello", "Copilot active", lambda: api.show_info("Dardcor Copilot loaded"))
    api.register_command("copilot.inline", "Trigger Inline Completion", lambda: api.show_info("Inline completion triggered"))
    api.register_command("copilot.chat", "Open Copilot Chat", lambda: api.show_info("Copilot chat opened"))

def deactivate():
    pass