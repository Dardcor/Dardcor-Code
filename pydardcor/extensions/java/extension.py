import json, os

def activate(api):
    api.register_command("java.hello", "java extension active", lambda: api.show_info("java extension loaded"))

def deactivate():
    pass