import json, os

def activate(api):
    api.register_command("xml.hello", "xml extension active", lambda: api.show_info("xml extension loaded"))

def deactivate():
    pass