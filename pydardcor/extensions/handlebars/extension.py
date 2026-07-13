import json, os

def activate(api):
    api.register_command("handlebars.hello", "handlebars extension active", lambda: api.show_info("handlebars extension loaded"))

def deactivate():
    pass