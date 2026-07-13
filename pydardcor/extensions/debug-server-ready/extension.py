import json, os, subprocess

def activate(api):
    api.register_command("debug-server-ready.hello", "Debug Server Ready active", lambda: api.show_info("Debug Server Ready loaded"))

def deactivate():
    pass