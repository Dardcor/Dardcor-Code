import json, os

def activate(api):
    api.register_command("theme-monokai-dimmed.hello", "theme-monokai-dimmed extension active", lambda: api.show_info("theme-monokai-dimmed extension loaded"))

def deactivate():
    pass