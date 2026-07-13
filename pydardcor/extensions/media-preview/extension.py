import json, os, subprocess

def activate(api):
    api.register_command("media-preview.hello", "Media Preview active", lambda: api.show_info("Media Preview loaded"))

def deactivate():
    pass