import json, os

def activate(api):
    api.register_command("php.hello", "php extension active", lambda: api.show_info("php extension loaded"))

def deactivate():
    pass