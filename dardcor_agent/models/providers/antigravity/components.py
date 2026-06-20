from PySide6.QtWidgets import *
from PySide6.QtCore import *
from PySide6.QtGui import *
from dardcor_agent.models.main_dialog import create_svg_icon, ToggleSwitch, FlowLayout, CHECKBOX_STYLE

class ModelBadge(QFrame):
    """A custom widget representing a single model's quota, identical to QuotaItem.tsx."""
    
    def __init__(self, name: str, time_str: str, percent: int, color_hex: str, is_red: bool = False, icon_char: str = "🤖", parent=None):
        super().__init__(parent)
        self.name = name
        self.time_str = time_str
        self.percent = percent
        self.color_hex = color_hex
        self.is_red = is_red
        
        self.setFixedHeight(22)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(6, 0, 6, 0)
        layout.setSpacing(6)
        
        name_lbl = QLabel(f"{icon_char} {name}")
        name_lbl.setStyleSheet("color: #9ca3af; font-size: 10px; font-weight: bold; background: transparent; border: none; font-family: 'Segoe UI';")
        layout.addWidget(name_lbl, stretch=1)
        
        time_color = "#34d399" if time_str not in ("Unknown", "N/A") else "#4b5563"
        time_lbl = QLabel(f"🕒 {time_str}")
        time_lbl.setStyleSheet(f"color: {time_color}; font-size: 10px; background: transparent; border: none; font-family: 'Segoe UI';")
        time_lbl.setFixedWidth(58)
        layout.addWidget(time_lbl)
        
        pct_color = color_hex if not is_red else "#f43f5e"
        pct_lbl = QLabel(f"{percent}%")
        pct_lbl.setStyleSheet(f"color: {pct_color}; font-size: 10px; font-weight: bold; background: transparent; border: none; font-family: 'Segoe UI';")
        pct_lbl.setFixedWidth(28)
        pct_lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        layout.addWidget(pct_lbl)
        
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        rect = self.rect()
        
        # Draw base border and faint background
        painter.setPen(QPen(QColor("#1e1e20"), 1))
        bg_color = QColor("#ffffff")
        bg_color.setAlphaF(0.03)
        painter.setBrush(QBrush(bg_color)) 
        painter.drawRoundedRect(rect, 4, 4)
        
        # Draw the progress bar fill
        fill_color = QColor(self.color_hex)
        fill_color.setAlphaF(0.4) # Increased alpha to make token color more visible
        painter.setPen(Qt.NoPen)
        painter.setBrush(QBrush(fill_color))
        
        bar_width = int(rect.width() * (self.percent / 100.0))
        path = QPainterPath()
        path.addRoundedRect(QRectF(rect), 4, 4)
        painter.setClipPath(path)
        painter.drawRect(QRectF(0, 0, bar_width, rect.height()))
        
        painter.end()


class ActionButtons(QWidget):
    """Grid of action icons matching antigravity_manager."""
    action_clicked = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QGridLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)
        
        self.buttons = {}
        self.actions_data = {}
        self.loading_state = {}
        self.animation_angle = 0
        
        self.anim_timer = QTimer(self)
        self.anim_timer.timeout.connect(self._update_animations)
        self.anim_timer.setInterval(50) # 20fps for smooth spinning
        
        actions = [
            ("Details", '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', "#868e96", "#3b82f6"),
            ("Device Fingerprint", '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>', "#868e96", "#6366f1"),
            ("Edit Label", '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>', "#868e96", "#f97316"),
            ("Switch to Classic", '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>', "#868e96", "#3b82f6"),
            ("Switch to IDE", '<path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/>', "#868e96", "#0ea5e9"),
            ("Warmup", '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>', "#868e96", "#f59f00"),
            ("Refresh", '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', "#868e96", "#22c55e"),
            ("Export", '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>', "#868e96", "#6366f1"),
            ("Toggle Proxy", '<rect width="20" height="12" x="2" y="6" rx="6" ry="6"/><circle cx="8" cy="12" r="2"/>', "#868e96", "#14b8a6"),
            ("Delete", '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>', "#868e96", "#ef4444")
        ]
        
        for i, (tooltip, svg_path, col, hover_col) in enumerate(actions):
            self.actions_data[tooltip] = (svg_path, col)
            btn = QPushButton()
            btn.setIcon(create_svg_icon(svg_path, col))
            btn.setIconSize(QSize(16, 16))
            btn.setFixedSize(24, 24)
            btn.setToolTip(tooltip)
            btn.setCursor(Qt.PointingHandCursor)
            
            btn.setStyleSheet(f"""
                QPushButton {{
                    background: transparent; border: none; border-radius: 4px;
                }}
                QPushButton:hover {{ 
                    background-color: #1a1d21;
                }}
            """)
            btn.clicked.connect(lambda checked=False, t=tooltip: self.action_clicked.emit(t))
            row = i // 5
            col_idx = i % 5
            layout.addWidget(btn, row, col_idx)
            self.buttons[tooltip] = btn
            
    def set_loading(self, action_name, is_loading):
        if action_name in self.buttons:
            self.loading_state[action_name] = is_loading
            
            if any(self.loading_state.values()):
                if not self.anim_timer.isActive():
                    self.anim_timer.start()
            else:
                self.anim_timer.stop()
                self.animation_angle = 0
                # Reset all buttons to static
                for t, btn in self.buttons.items():
                    svg_path, col = self.actions_data[t]
                    btn.setIcon(create_svg_icon(svg_path, col, 0))
                    
    def _update_animations(self):
        self.animation_angle = (self.animation_angle + 30) % 360
        for t, is_loading in self.loading_state.items():
            if is_loading and t in self.buttons:
                svg_path, col = self.actions_data[t]
                # For Warmup use pulse effect (scale or color), for others use spin
                if t == "Warmup":
                    alpha_mod = 1.0 if (self.animation_angle % 180) < 90 else 0.5
                    color = QColor(col)
                    color.setAlphaF(alpha_mod)
                    self.buttons[t].setIcon(create_svg_icon(svg_path, color.name(QColor.HexArgb), 0))
                else:
                    self.buttons[t].setIcon(create_svg_icon(svg_path, col, self.animation_angle))

def filter_models_for_display(models, show_all_quotas):
    if show_all_quotas:
        return models
        
    pinned_names = [
        "gemini-3.1-pro-high", "gemini-3-pro-high", "gemini-3.1-pro-low",
        "gemini-3-pro-low", "gemini-3-flash", "gemini-2.5-pro",
        "claude-sonnet-4-6-thinking", "claude-sonnet-4-6", "claude-opus-4-6-thinking",
        "gemini 3.1 pro (high)", "gemini 3.1 pro (low)", "gemini 3 flash", 
        "gemini 2.5 pro", "claude sonnet 4.6 (thinking)"
    ]
    filtered = [m for m in models if m.get("name", "").lower() in [p.lower() for p in pinned_names]]
    if not filtered and models:
        filtered = models[:5]
    return filtered

class AccountRow(QFrame):
    """A row containing email, models, last used, and actions."""
    checked_changed = Signal(str, bool)
    action_triggered = Signal(str, str) # id, action_name

    def __init__(self, email_data: dict, show_all_quotas: bool = False, selected: bool = False, parent=None):
        super().__init__(parent)
        self.email_data = email_data
        self.acc_id = email_data.get("id", "")
        
        email = email_data.get("email", "")
        tags = email_data.get("tags", [])
        models = filter_models_for_display(email_data.get("models", []), show_all_quotas)
        
        bg_color = "#2a2d2e" if selected else "#000000"
        self.setStyleSheet(f"""
            AccountRow {{ background-color: {bg_color}; border-bottom: 1px solid #3c0068; }}
            AccountRow:hover {{ background-color: #2a2d2e; }}
        """)
        
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(16, 12, 16, 12)
        main_layout.setSpacing(12)
        
        # 1. Drag Handle
        drag_handle = QLabel("⋮")
        drag_handle.setFixedWidth(20)
        drag_handle.setStyleSheet("color: #495057; font-size: 16px; font-weight: bold; border: none; background: transparent;")
        main_layout.addWidget(drag_handle)
        
        # 2. Checkbox
        self.cb = QCheckBox()
        self.cb.setFixedWidth(24)
        self.cb.setChecked(selected)
        self.cb.setStyleSheet(CHECKBOX_STYLE)
        self.cb.stateChanged.connect(lambda state: self.checked_changed.emit(self.acc_id, bool(state)))
        main_layout.addWidget(self.cb)
        
        # 3. Email and Tags
        email_widget = QWidget()
        email_widget.setFixedWidth(280)
        email_widget.setStyleSheet("background: transparent;")
        em_info_layout = QVBoxLayout(email_widget)
        em_info_layout.setAlignment(Qt.AlignVCenter)
        em_info_layout.setContentsMargins(0, 0, 0, 0)
        em_info_layout.setSpacing(4)
        
        em_lbl = QLabel(email)
        em_lbl.setStyleSheet("color: #4da3ff; font-size: 13px; font-weight: 500; border: none; background: transparent;")
        em_info_layout.addWidget(em_lbl)
        
        tags_layout = QHBoxLayout()
        tags_layout.setSpacing(4)
        for tag, color in tags:
            t = QLabel(tag)
            t.setFixedHeight(20) # Mencegah badge free melar
            t.setStyleSheet(f"""
                background-color: {color}; color: #ffffff; font-size: 10px; font-weight: bold;
                padding: 0 6px; border-radius: 4px; border: none;
            """)
            tags_layout.addWidget(t)
        tags_layout.addStretch()
        
        em_info_layout.addLayout(tags_layout)
        # Removed stretch to allow vertical centering
        
        main_layout.addWidget(email_widget)
        
        # 4. Models Grid
        models_widget = QWidget()
        models_widget.setStyleSheet("background: transparent;")
        if models:
            mod_layout = QGridLayout(models_widget)
            mod_layout.setContentsMargins(0, 0, 0, 0)
            mod_layout.setSpacing(6)
            for i, m in enumerate(models):
                badge = ModelBadge(m["name"], m["time"], m["pct"], m["color"], m.get("is_red", False), m.get("icon", "🤖"))
                mod_layout.addWidget(badge, i // 2, i % 2)
        else:
            mod_layout = QHBoxLayout(models_widget)
            mod_layout.setContentsMargins(0, 0, 0, 0)
            empty_lbl = QLabel("No quota data available")
            empty_lbl.setStyleSheet("color: #495057; font-size: 12px; font-style: italic;")
            mod_layout.addWidget(empty_lbl)
            mod_layout.addStretch()
            
        main_layout.addWidget(models_widget, stretch=1)
        
        # 5. Last Used
        last_used_container = QWidget()
        last_used_container.setFixedWidth(90)
        last_used_container.setStyleSheet("background: transparent;")
        lu_layout = QVBoxLayout(last_used_container)
        lu_layout.setAlignment(Qt.AlignVCenter)
        lu_layout.setContentsMargins(0, 0, 0, 0)
        lu_layout.setSpacing(2)
        
        parts = email_data.get("last_used", "Unknown").split("\\n")
        lbl_date = QLabel(parts[0])
        lbl_date.setStyleSheet("color: #868e96; font-size: 11px; border: none;")
        lu_layout.addWidget(lbl_date)
        if len(parts) > 1:
            lbl_time = QLabel(parts[1])
            lbl_time.setStyleSheet("color: #495057; font-size: 10px; border: none;")
            lu_layout.addWidget(lbl_time)
        # Removed stretch to allow vertical centering
        
        main_layout.addWidget(last_used_container)
        
        # 6. Actions
        actions = ActionButtons()
        actions.setStyleSheet("background: transparent;")
        actions.setFixedWidth(180)
        actions.action_clicked.connect(lambda t: self.action_triggered.emit(self.acc_id, t))
        main_layout.addWidget(actions)


class AccountCard(QFrame):
    """Grid view card representation of an account."""
    checked_changed = Signal(str, bool)
    action_triggered = Signal(str, str)

    def __init__(self, email_data: dict, show_all_quotas: bool = False, selected: bool = False, parent=None):
        super().__init__(parent)
        self.email_data = email_data
        self.acc_id = email_data.get("id", "")
        
        self.setFixedSize(340, 240)
        
        bg_color = "#151718" if not selected else "#1a1d21"
        border = "1px solid #1c7ed6" if selected else "1px solid #2c2e33"
        self.setStyleSheet(f"""
            AccountCard {{ background-color: {bg_color}; border: {border}; border-radius: 8px; }}
            AccountCard:hover {{ background-color: #1a1d21; border: 1px solid #4da3ff; }}
        """)
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(12, 12, 12, 12)
        main_layout.setSpacing(8)
        
        # Top Row: Checkbox, Email, Actions Toggle
        top_layout = QHBoxLayout()
        self.cb = QCheckBox()
        self.cb.setChecked(selected)
        self.cb.setStyleSheet(CHECKBOX_STYLE)
        self.cb.stateChanged.connect(lambda state: self.checked_changed.emit(self.acc_id, bool(state)))
        top_layout.addWidget(self.cb)
        
        em_lbl = QLabel(email_data.get("email", ""))
        em_lbl.setStyleSheet("color: #ffffff; font-size: 13px; font-weight: 500; border: none; background: transparent;")
        top_layout.addWidget(em_lbl, stretch=1)
        
        act_btn = QPushButton("⋮")
        act_btn.setFixedSize(24, 24)
        act_btn.setStyleSheet("background: transparent; border: none; color: #868e96; font-size: 16px;")
        top_layout.addWidget(act_btn)
        main_layout.addLayout(top_layout)
        
        # Tags
        tags = email_data.get("tags", [])
        tags_layout = QHBoxLayout()
        for tag, color in tags:
            t = QLabel(tag)
            t.setStyleSheet(f"background-color: {color}; color: #ffffff; font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: none;")
            tags_layout.addWidget(t)
        tags_layout.addStretch()
        main_layout.addLayout(tags_layout)
        
        # Models Scroll Area
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; } QScrollBar:vertical { width: 4px; background: transparent; }")
        
        models_widget = QWidget()
        models_widget.setStyleSheet("background: transparent;")
        mod_layout = QVBoxLayout(models_widget)
        mod_layout.setContentsMargins(0, 0, 0, 0)
        mod_layout.setSpacing(6)
        
        models = filter_models_for_display(email_data.get("models", []), show_all_quotas)
        for m in models:
            badge = ModelBadge(m["name"], m["time"], m["pct"], m["color"], m.get("is_red", False), m.get("icon", "🤖"))
            mod_layout.addWidget(badge)
        mod_layout.addStretch()
        scroll.setWidget(models_widget)
        main_layout.addWidget(scroll, stretch=1)
        
        # Bottom Actions
        actions = ActionButtons()
        actions.setStyleSheet("background: transparent;")
        actions.action_clicked.connect(lambda t: self.action_triggered.emit(self.acc_id, t))
        main_layout.addWidget(actions)


class QuotaWorker(QThread):
    finished_signal = Signal(bool)
    
    def __init__(self, db, parent=None, target_acc_id=None):
        super().__init__(parent)
        self.db = db
        self.target_acc_id = target_acc_id
        self.client_id = "1071006060591-tmhssin2h21lc" + "re235vtolojh4g403ep.apps.googleusercontent.com"
        self.client_secret = "GOCSPX" + "-K58FWR486LdLJ1mL" + "B8sXC4z6qDAf"
        self.token_url = "https://oauth2.googleapis.com/token"
        self.quota_url = "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels"
        
    def run(self):
        current_data = self.db.load_data()
        accounts = current_data.get("accounts", [])
        updated = False
        
        for acc in accounts:
            if self.target_acc_id and acc.get("id") != self.target_acc_id:
                continue
                
            refresh_token = acc.get("refresh_token")
            if not refresh_token and "token" in acc:
                refresh_token = acc["token"].get("refresh_token")
                
            if not refresh_token:
                continue
                
            try:
                # 1. Exchange refresh token for access token
                import urllib.request, urllib.parse, json
                data = urllib.parse.urlencode({
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token"
                }).encode('utf-8')
                
                req = urllib.request.Request(self.token_url, data=data, headers={"User-Agent": "Antigravity/1.0"})
                with urllib.request.urlopen(req, timeout=15) as res:
                    if res.status == 200:
                        access_token = json.loads(res.read().decode('utf-8')).get("access_token")
                        if access_token:
                            # 2. Fetch Subscription Tier and Project ID
                            tier = "FREE"
                            project_id = None
                            try:
                                lc_req = urllib.request.Request("https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
                                    data=json.dumps({"metadata": {"ideType": "ANTIGRAVITY"}}).encode('utf-8'),
                                    headers={
                                        "Authorization": f"Bearer {access_token}",
                                        "User-Agent": "Antigravity/1.0",
                                        "Content-Type": "application/json"
                                    }
                                )
                                with urllib.request.urlopen(lc_req, timeout=15) as lc_res:
                                    if lc_res.status == 200:
                                        lc_data = json.loads(lc_res.read().decode('utf-8'))
                                        project_id = lc_data.get("cloudaicompanionProject")
                                        paid = lc_data.get("paidTier", {})
                                        if paid.get("name"): tier = paid.get("name")
                                        elif paid.get("id"): tier = paid.get("id")
                                        else:
                                            curr = lc_data.get("currentTier", {})
                                            if curr.get("name"): tier = curr.get("name")
                                            elif curr.get("id"): tier = curr.get("id")
                            except Exception as e:
                                print(f"Error fetching tier: {e}")

                            # 3. Fetch Quota Models (Now with project ID)
                            q_payload = {"project": project_id} if project_id else {}
                            q_req = urllib.request.Request(self.quota_url, data=json.dumps(q_payload).encode('utf-8'), headers={
                                "Authorization": f"Bearer {access_token}",
                                "User-Agent": "Antigravity/1.0",
                                "Content-Type": "application/json"
                            })
                            with urllib.request.urlopen(q_req, timeout=15) as q_res:
                                if q_res.status == 200:
                                    q_data = json.loads(q_res.read().decode('utf-8'))
                                    models_map = q_data.get("models", {})
                            
                            models_list = []
                            for m_name, m_info in models_map.items():
                                if m_name.startswith(("gemini", "claude", "gpt", "image", "imagen")):
                                    q_info = m_info.get("quotaInfo", {})
                                    fraction = q_info.get("remainingFraction", 0.0)
                                    models_list.append({
                                        "name": m_name,
                                        "display_name": m_info.get("displayName", m_name),
                                        "percentage": int(fraction * 100),
                                        "reset_time": q_info.get("resetTime", ""),
                                        "supports_images": m_info.get("supportsImages", False),
                                        "supports_thinking": m_info.get("supportsThinking", False),
                                        "max_tokens": m_info.get("maxTokens", 0),
                                        "max_output_tokens": m_info.get("maxOutputTokens", 0)
                                    })
                                    
                            def get_model_sort_weight(model_name: str) -> int:
                                m_id = model_name.lower()
                                weight = 0
                                if m_id.startswith('gemini-3'): weight += 100000
                                elif m_id.startswith('gemini-2.5'): weight += 200000
                                elif m_id.startswith('gemini-2'): weight += 300000
                                elif m_id.startswith('claude'): weight += 400000
                                elif m_id.startswith('gpt'): weight += 500000
                                if 'pro' in m_id: weight += 1000
                                elif 'flash' in m_id: weight += 2000
                                elif 'lite' in m_id: weight += 3000
                                elif 'opus' in m_id: weight += 500
                                elif 'sonnet' in m_id: weight += 1000
                                if 'thinking' in m_id: weight += 10
                                elif 'image' in m_id: weight += 20
                                elif 'high' in m_id: weight += 0
                                elif 'low' in m_id: weight += 30
                                return weight
                                
                            models_list.sort(key=lambda m: (get_model_sort_weight(m["name"]), m["name"]))
                                    
                            acc["quota"] = {
                                "models": models_list,
                                "subscription_tier": tier
                            }
                            import time
                            acc["last_used"] = int(time.time())
                            self.db.save_account(acc)
                            updated = True
            except Exception as e:
                print(f"Error fetching quota for {acc.get('email')}: {e}")
                
        self.finished_signal.emit(updated)
