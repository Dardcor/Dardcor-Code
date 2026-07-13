import json, os

def activate(api):
    api.register_command("make.hello", "make extension active", lambda: api.show_info("make extension loaded"))

def deactivate():
    pass