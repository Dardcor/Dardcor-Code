import json, os

def activate(api):
    api.register_command("coffeescript.hello", "coffeescript extension active", lambda: api.show_info("coffeescript extension loaded"))

def deactivate():
    pass