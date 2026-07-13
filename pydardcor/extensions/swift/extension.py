import json, os

def activate(api):
    api.register_command("swift.hello", "swift extension active", lambda: api.show_info("swift extension loaded"))

def deactivate():
    pass