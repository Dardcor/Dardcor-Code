import json, os, subprocess

def activate(api):
    api.register_command("simple-browser.hello", "Simple Browser active", lambda: api.show_info("Simple Browser loaded"))

def deactivate():
    pass