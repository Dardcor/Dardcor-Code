import json, os, subprocess

def activate(api):
    api.register_command("markdown-math.hello", "Markdown Math active", lambda: api.show_info("Markdown Math loaded"))

def deactivate():
    pass