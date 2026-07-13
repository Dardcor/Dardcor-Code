import json, os

def activate(api):
    api.register_command("dotenv.hello", "dotenv extension active", lambda: api.show_info("dotenv extension loaded"))

def deactivate():
    pass