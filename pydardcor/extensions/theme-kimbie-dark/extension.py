import json, os

def activate(api):
    api.register_command("theme-kimbie-dark.hello", "theme-kimbie-dark extension active", lambda: api.show_info("theme-kimbie-dark extension loaded"))

def deactivate():
    pass