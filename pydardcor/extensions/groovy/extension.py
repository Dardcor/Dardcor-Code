import json, os

def activate(api):
    api.register_command("groovy.hello", "groovy extension active", lambda: api.show_info("groovy extension loaded"))

def deactivate():
    pass