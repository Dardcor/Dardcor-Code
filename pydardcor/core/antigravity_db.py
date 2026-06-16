"""Database manager for Antigravity-Manager style models and quotas."""

import os
import json
import time
from typing import List, Dict, Any

class AntigravityDB:
    def __init__(self, root_path: str):
        self.root_path = root_path
        self.db_dir = os.path.join(self.root_path, "database", "models", "Antigravity")
        self.accounts_file = os.path.join(self.db_dir, "accounts.json")
        self._ensure_db()

    def _ensure_db(self):
        """Ensure the database directory and accounts.json exist."""
        if not os.path.exists(self.db_dir):
            os.makedirs(self.db_dir, exist_ok=True)
            
        if not os.path.exists(self.accounts_file):
            self._seed_mock_data()

    def _seed_mock_data(self):
        """Seed the database with the mock data if it doesn't exist."""
        data = {
            "version": "2.0",
            "accounts": [
                {
                    "id": "acc-1",
                    "email": "syahrul.ardi2005@gmail.com",
                    "tags": [["CURRENT", "#1971c2"], ["\u2666 PRO", "#4263eb"]],
                    "models": [
                        {"name": "GPT-o1 120B (Medium)", "time": "2d 7h", "pct": 8, "color": "#e03131", "is_red": True},
                        {"name": "Gemini 3.1 Pro (High)", "time": "4h 35m", "pct": 95, "color": "#20c997"},
                        {"name": "Gemini 3.1 Pro (High)", "time": "4h 35m", "pct": 95, "color": "#1c7ed6"},
                        {"name": "Gemini 3.1 Pro (Low)", "time": "4h 35m", "pct": 95, "color": "#1c7ed6"},
                        {"name": "Gemini 3 Flash", "time": "4h 35m", "pct": 95, "color": "#22b8cf"},
                        {"name": "Gemini 3.5 Flash (High)", "time": "4h 35m", "pct": 95, "color": "#20c997"},
                        {"name": "Gemini 3.1 Flash Lite", "time": "4h 35m", "pct": 95, "color": "#40c057"},
                        {"name": "Gemini 3.1 Flash Image", "time": "4h 35m", "pct": 95, "color": "#1c7ed6"},
                        {"name": "Gemini 3.5 Flash (Low)", "time": "4h 35m", "pct": 95, "color": "#40c057"},
                        {"name": "Gemini 3.5 Flash (Medium)", "time": "4h 35m", "pct": 95, "color": "#40c057"},
                        {"name": "Gemini 2.5 Pro", "time": "4h 35m", "pct": 95, "color": "#1c7ed6"},
                        {"name": "Gemini 3.1 Flash Lite", "time": "4h 35m", "pct": 95, "color": "#1c7ed6"},
                        {"name": "Claude Sonnet 4.6 (Thinking)", "time": "2d 7h", "pct": 8, "color": "#e67700", "is_red": True},
                    ],
                    "last_used": "6/16/2026\n01:27 PM"
                },
                {
                    "id": "acc-2",
                    "email": "afdanikomalik@gmail.com",
                    "tags": [["\u26aa FREE", "#373a40"]],
                    "models": [
                        {"name": "GPT-o1 120B (Medium)", "time": "6d 23h", "pct": 100, "color": "#40c057"},
                        {"name": "Gemini 3.1 Pro (High)", "time": "6d 23h", "pct": 100, "color": "#40c057"},
                        {"name": "Gemini 3.1 Pro (High)", "time": "6d 23h", "pct": 100, "color": "#1c7ed6"},
                        {"name": "Gemini 3.1 Pro (Low)", "time": "6d 23h", "pct": 100, "color": "#1c7ed6"},
                        {"name": "Gemini 3 Flash", "time": "6d 23h", "pct": 100, "color": "#22b8cf"},
                        {"name": "Gemini 3.5 Flash (High)", "time": "6d 23h", "pct": 100, "color": "#40c057"},
                        {"name": "Gemini 3.1 Flash Lite", "time": "6d 23h", "pct": 100, "color": "#40c057"},
                        {"name": "Gemini 3.1 Flash Image", "time": "6d 23h", "pct": 100, "color": "#1c7ed6"},
                        {"name": "Gemini 3.5 Flash (Low)", "time": "6d 23h", "pct": 100, "color": "#40c057"},
                        {"name": "Gemini 3.5 Flash (Medium)", "time": "6d 23h", "pct": 100, "color": "#40c057"},
                        {"name": "Gemini 2.5 Pro", "time": "6d 23h", "pct": 100, "color": "#1c7ed6"},
                        {"name": "Gemini 3.1 Flash Lite", "time": "6d 23h", "pct": 100, "color": "#1c7ed6"},
                    ],
                    "last_used": "6/15/2026\n09:15 AM"
                }
            ]
        }
        self.save_data(data)

    def load_data(self) -> Dict[str, Any]:
        """Load data from accounts.json."""
        try:
            with open(self.accounts_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"accounts": []}

    def save_data(self, data: Dict[str, Any]):
        """Save data to accounts.json."""
        with open(self.accounts_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

    def get_all_accounts(self) -> List[Dict[str, Any]]:
        return self.load_data().get("accounts", [])
