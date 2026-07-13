import json, os, subprocess

def activate(api):
    api.register_command("references-view.hello", "References View active", lambda: api.show_info("References View loaded"))

def deactivate():
    pass