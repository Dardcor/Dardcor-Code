import json, os, subprocess

def activate(api):
    api.register_command("debug-auto-launch.hello", "Debug Auto Launch active", lambda: api.show_info("Debug Auto Launch loaded"))

def deactivate():
    pass