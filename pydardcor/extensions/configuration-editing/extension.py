import json, os, subprocess

def activate(api):
    api.register_command("configuration-editing.hello", "Configuration Editing active", lambda: api.show_info("Configuration Editing loaded"))

def deactivate():
    pass