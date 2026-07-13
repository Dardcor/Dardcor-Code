import json, os

def activate(api):
    api.register_command("objective-c.hello", "objective-c extension active", lambda: api.show_info("objective-c extension loaded"))

def deactivate():
    pass