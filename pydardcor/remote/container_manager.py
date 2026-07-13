"""Docker Container Manager - Full container lifecycle, images, and Compose management."""

import json
import os
import time
import logging
import threading
import subprocess
from typing import List, Dict, Optional, Callable, Any
from dataclasses import dataclass, field, asdict
from PySide6.QtCore import QObject, Signal, QTimer

logger = logging.getLogger(__name__)


@dataclass
class ContainerInfo:
    id: str
    name: str
    image: str
    status: str
    state: str
    ports: str = ""
    created: str = ""
    labels: Dict[str, str] = field(default_factory=dict)
    mounts: List[Dict] = field(default_factory=list)
    networks: List[str] = field(default_factory=list)


@dataclass
class ImageInfo:
    id: str
    repository: str
    tag: str
    size: str
    created: str


@dataclass
class ComposeProject:
    name: str
    config_files: List[str] = field(default_factory=list)
    status: str = "stopped"
    services: List[Dict] = field(default_factory=list)


class DockerManager(QObject):
    """Full Docker container and image management."""

    containers_changed = Signal()
    images_changed = Signal()
    compose_projects_changed = Signal()
    container_logs = Signal(str, str)
    container_stats = Signal(str, dict)
    docker_error = Signal(str)
    docker_available_changed = Signal(bool)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._containers: List[ContainerInfo] = []
        self._images: List[ImageInfo] = []
        self._compose_projects: List[ComposeProject] = []
        self._monitoring = False
        self._monitor_timer = QTimer(self)
        self._monitor_timer.timeout.connect(self._refresh_all)
        self._available = self._check_docker()

    def _check_docker(self) -> bool:
        try:
            result = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"],
                                    capture_output=True, text=True, timeout=5)
            return result.returncode == 0 and bool(result.stdout.strip())
        except Exception:
            return False

    def is_available(self) -> bool:
        return self._available

    # ── Container Operations ─────────────────────────────────────────────

    def list_containers(self, all: bool = True) -> List[ContainerInfo]:
        """List Docker containers."""
        fmt = '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}|{{.CreatedAt}}'
        args = ["docker", "ps", "-a", "--format", fmt] if all else ["docker", "ps", "--format", fmt]
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=15)
            if result.returncode != 0:
                return []
            containers = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                parts = line.split('|')
                if len(parts) >= 5:
                    container = ContainerInfo(
                        id=parts[0][:12],
                        name=parts[1],
                        image=parts[2],
                        status=parts[3],
                        state=parts[4],
                        ports=parts[5] if len(parts) > 5 else "",
                        created=parts[6] if len(parts) > 6 else "",
                    )
                    containers.append(container)
            self._containers = containers
            return containers
        except subprocess.TimeoutExpired:
            logger.error("Docker ps timed out")
            return []
        except Exception as e:
            logger.error(f"Failed to list containers: {e}")
            return []

    def start_container(self, container_id: str) -> bool:
        try:
            result = subprocess.run(["docker", "start", container_id],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    def stop_container(self, container_id: str, timeout: int = 10) -> bool:
        try:
            result = subprocess.run(["docker", "stop", "-t", str(timeout), container_id],
                                    capture_output=True, text=True, timeout=timeout + 10)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    def restart_container(self, container_id: str) -> bool:
        try:
            result = subprocess.run(["docker", "restart", container_id],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    def remove_container(self, container_id: str, force: bool = False) -> bool:
        try:
            args = ["docker", "rm"]
            if force:
                args.append("-f")
            args.append(container_id)
            result = subprocess.run(args, capture_output=True, text=True, timeout=15)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    def exec_in_container(self, container_id: str, command: str) -> Dict:
        """Execute a command inside a container."""
        try:
            result = subprocess.run(
                ["docker", "exec", container_id, "sh", "-c", command],
                capture_output=True, text=True, timeout=30
            )
            return {
                "exit_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except Exception as e:
            return {"exit_code": -1, "stdout": "", "stderr": str(e)}

    # ── Image Operations ────────────────────────────────────────────────

    def list_images(self) -> List[ImageInfo]:
        fmt = '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}'
        try:
            result = subprocess.run(["docker", "images", "--format", fmt],
                                    capture_output=True, text=True, timeout=15)
            if result.returncode != 0:
                return []
            images = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                parts = line.split('|')
                if len(parts) >= 3:
                    image = ImageInfo(
                        id=parts[0],
                        repository=parts[1],
                        tag=parts[2] if len(parts) > 2 else "<none>",
                        size=parts[3] if len(parts) > 3 else "",
                        created=parts[4] if len(parts) > 4 else "",
                    )
                    images.append(image)
            self._images = images
            return images
        except Exception as e:
            logger.error(f"Failed to list images: {e}")
            return []

    def pull_image(self, image: str, tag: str = "latest") -> bool:
        def _pull():
            try:
                result = subprocess.run(
                    ["docker", "pull", f"{image}:{tag}"],
                    capture_output=True, text=True, timeout=300
                )
                if result.returncode == 0:
                    self._refresh_all()
                else:
                    self.docker_error.emit(result.stderr)
            except Exception as e:
                self.docker_error.emit(str(e))
        threading.Thread(target=_pull, daemon=True).start()
        return True

    def remove_image(self, image_id: str, force: bool = False) -> bool:
        try:
            args = ["docker", "rmi"]
            if force:
                args.append("-f")
            args.append(image_id)
            result = subprocess.run(args, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    # ── Docker Compose ──────────────────────────────────────────────────

    def list_compose_projects(self) -> List[ComposeProject]:
        try:
            result = subprocess.run(
                ["docker", "compose", "ls", "--format", "json"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode != 0:
                return []
            projects = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    project = ComposeProject(
                        name=data.get("Name", ""),
                        config_files=data.get("ConfigFiles", "").split(","),
                        status=data.get("Status", "unknown"),
                    )
                    projects.append(project)
                except json.JSONDecodeError:
                    continue
            self._compose_projects = projects
            return projects
        except Exception:
            return []

    def compose_up(self, project_dir: str, detach: bool = True) -> bool:
        try:
            args = ["docker", "compose", "-f", os.path.join(project_dir, "docker-compose.yml")]
            if detach:
                args.append("-d")
            args.append("up")
            result = subprocess.run(args, capture_output=True, text=True, timeout=120, cwd=project_dir)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    def compose_down(self, project_dir: str) -> bool:
        try:
            args = ["docker", "compose", "-f", os.path.join(project_dir, "docker-compose.yml"), "down"]
            result = subprocess.run(args, capture_output=True, text=True, timeout=60, cwd=project_dir)
            if result.returncode == 0:
                self._refresh_all()
                return True
            self.docker_error.emit(result.stderr)
            return False
        except Exception as e:
            self.docker_error.emit(str(e))
            return False

    def compose_ps(self, project_dir: str) -> List[Dict]:
        try:
            args = ["docker", "compose", "-f", os.path.join(project_dir, "docker-compose.yml"), "ps", "--format", "json"]
            result = subprocess.run(args, capture_output=True, text=True, timeout=15, cwd=project_dir)
            if result.returncode != 0:
                return []
            services = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                try:
                    services.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
            return services
        except Exception:
            return []

    # ── Container Logs ──────────────────────────────────────────────────

    def stream_logs(self, container_id: str, tail: int = 100, follow: bool = True):
        """Stream container logs in a background thread."""
        def _stream():
            try:
                args = ["docker", "logs", "--tail", str(tail), "-t"]
                if follow:
                    args.append("-f")
                args.append(container_id)
                with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      text=True, bufsize=1) as proc:
                    for line in proc.stdout:
                        self.container_logs.emit(container_id, line.rstrip())
            except Exception as e:
                logger.error(f"Log stream error: {e}")

        thread = threading.Thread(target=_stream, daemon=True)
        thread.start()

    # ── Container Stats ─────────────────────────────────────────────────

    def stream_stats(self, container_id: str):
        """Stream live container stats."""
        def _stream():
            try:
                args = ["docker", "stats", "--no-stream", "--format", "json", container_id]
                while True:
                    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
                    if result.returncode == 0 and result.stdout.strip():
                        try:
                            stats = json.loads(result.stdout.strip())
                            self.container_stats.emit(container_id, stats)
                        except json.JSONDecodeError:
                            pass
                    time.sleep(2)
            except Exception:
                pass

        thread = threading.Thread(target=_stream, daemon=True)
        thread.start()

    # ── Monitoring ──────────────────────────────────────────────────────

    def start_monitoring(self, interval_ms: int = 5000):
        """Start periodic container refresh."""
        self._monitoring = True
        self._monitor_timer.start(interval_ms)

    def stop_monitoring(self):
        self._monitoring = False
        self._monitor_timer.stop()

    def _refresh_all(self):
        try:
            self.list_containers()
            self.containers_changed.emit()
        except Exception:
            pass

    def prune_containers(self) -> bool:
        """Remove all stopped containers."""
        try:
            result = subprocess.run(["docker", "container", "prune", "-f"],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                self._refresh_all()
                return True
            return False
        except Exception:
            return False

    def get_container_env(self, container_id: str) -> Dict[str, str]:
        """Get environment variables of a container."""
        try:
            result = subprocess.run(
                ["docker", "inspect", "--format", "{{json .Config.Env}}", container_id],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                env_list = json.loads(result.stdout.strip())
                return dict(e.split("=", 1) for e in env_list if "=" in e)
            return {}
        except Exception:
            return {}

    def get_container_ip(self, container_id: str) -> str:
        """Get the IP address of a container."""
        try:
            result = subprocess.run(
                ["docker", "inspect", "--format", "{{.NetworkSettings.IPAddress}}", container_id],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                return result.stdout.strip()
            return ""
        except Exception:
            return ""

    def cleanup(self):
        self.stop_monitoring()


class ContainerFileSystem:
    """Container filesystem access via docker cp/exec (shell-out)."""

    def __init__(self, container_id: str):
        self.container_id = container_id

    def _run_docker_exec(self, cmd: str) -> subprocess.CompletedProcess:
        full_cmd = ["docker", "exec", self.container_id, "sh", "-c", cmd]
        return subprocess.run(full_cmd, capture_output=True, text=True, timeout=30)

    def read_file(self, path: str) -> bytes:
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            temp_path = tf.name
        try:
            cmd = ["docker", "cp", f"{self.container_id}:{path}", temp_path]
            result = subprocess.run(cmd, capture_output=True, timeout=15)
            if result.returncode != 0:
                raise FileNotFoundError(f"Container file not found: {path}")
            with open(temp_path, 'rb') as f:
                return f.read()
        finally:
            os.remove(temp_path)

    def write_file(self, path: str, content: bytes):
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            tf.write(content)
            temp_path = tf.name
        try:
            remote_dir = os.path.dirname(path)
            self._run_docker_exec(f"mkdir -p {remote_dir}")
            cmd = ["docker", "cp", temp_path, f"{self.container_id}:{path}"]
            subprocess.run(cmd, check=True, timeout=15)
        finally:
            os.remove(temp_path)

    def list_dir(self, path: str) -> List:
        result = self._run_docker_exec(f"stat -c '%n|%F|%s|%Y' {path}/* 2>/dev/null; stat -c '%n|%F|%s|%Y' {path}/.* 2>/dev/null")
        if result.returncode != 0 or not result.stdout.strip():
            return []
        items = []
        seen = set()
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            parts = line.split('|')
            if len(parts) >= 4:
                name = os.path.basename(parts[0])
                if name in (".", "..") or name in seen:
                    continue
                seen.add(name)
                is_dir = parts[1] == "directory"
                size = int(parts[2])
                mtime = float(parts[3])
                items.append((name, {"is_dir": is_dir, "size": size, "mtime": mtime}))
        return items

    def stat(self, path: str) -> Optional[dict]:
        result = self._run_docker_exec(f"stat -c '%F|%s|%Y' {path} 2>/dev/null")
        if result.returncode != 0 or not result.stdout.strip():
            return None
        parts = result.stdout.strip().split('|')
        if len(parts) >= 3:
            return {
                "is_dir": parts[0] == "directory",
                "size": int(parts[1]),
                "mtime": float(parts[2]),
            }
        return None

    def mkdir(self, path: str):
        self._run_docker_exec(f"mkdir -p {path}")

    def delete(self, path: str, recursive: bool = False):
        if recursive:
            self._run_docker_exec(f"rm -rf {path}")
        else:
            self._run_docker_exec(f"rm {path}")

    def exists(self, path: str) -> bool:
        result = self._run_docker_exec(f"test -e {path} && echo yes || echo no")
        return result.stdout.strip() == "yes"
