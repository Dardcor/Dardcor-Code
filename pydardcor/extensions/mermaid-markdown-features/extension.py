import json, os, subprocess

def activate(api):
    api.register_command("mermaid-markdown-features.hello", "Mermaid Markdown active", lambda: api.show_info("Mermaid Markdown loaded"))

def deactivate():
    pass