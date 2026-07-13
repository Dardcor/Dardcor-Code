import json, os

def activate(api):
    api.register_command("markdown-basics.hello", "markdown-basics extension active", lambda: api.show_info("markdown-basics extension loaded"))

def deactivate():
    pass