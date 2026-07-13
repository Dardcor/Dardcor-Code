import json, os, subprocess

def activate(api):
    api.register_command("npm.hello", "npm active", lambda: api.show_info("npm loaded"))

def deactivate():
    pass