/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use ::http::{Request, Response};
use http_body_util::BodyExt;
use hyper::body::Incoming;
use hyper::service::service_fn;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as ServerBuilder;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::async_pipe::{get_socket_name, get_socket_rw_stream, listen_socket_rw_stream, AsyncPipeListener};
use crate::constants::VSCODE_CLI_QUALITY;
use crate::download_cache::DownloadCache;
use crate::log;
use crate::options::Quality;
use crate::update_service::{
	unzip_downloaded_release, Platform, Release, TargetKind, UpdateService,
};
use crate::util::command::{kill_tree, new_script_command};
use crate::util::errors::{AnyError, CodeError};
use crate::util::http::{self, BoxedHttp};
use crate::util::http::{empty_body, full_body, HyperBody};
use crate::util::io::SilentCopyProgress;
use crate::util::sync::{new_barrier, Barrier, BarrierOpener};

use super::agent_host_metadata::{
	remove_agent_host_metadata_for_pid, write_agent_host_metadata, AgentHostMetadata,
};
use super::paths::{get_server_folder_name, SERVER_FOLDER_NAME};
use super::shutdown_signal::ShutdownSignal;

pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
pub const UPDATE_POLL_INTERVAL: Duration = Duration::from_secs(10 * 60);
pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
pub const MANAGEMENT_SOCKET_ENV: &str = "VSCODE_AGENT_HOST_MANAGEMENT_SOCKET";

pub const INITIAL_AGENT_HOST_VERSION_ENV: &str = "VSCODE_CLI_INITIAL_AH_VERSION";

fn initial_agent_host_version() -> Option<String> {
	match std::env::var(INITIAL_AGENT_HOST_VERSION_ENV) {
		Ok(v) => {
			let v = v.trim();
			if !v.is_empty() && v.chars().all(|c| c.is_ascii_hexdigit()) {
				Some(v.to_string())
			} else {
				None
			}
		}
		_ => None,
	}
}

const UPGRADE_KILL_DELAY: Duration = Duration::from_secs(3);

#[derive(Clone, Debug)]
pub struct AgentHostConfig {
	pub server_data_dir: Option<String>,
	pub without_connection_token: bool,
	pub connection_token: Option<String>,
	pub connection_token_file: Option<String>,
}

struct RunningServer {
	child: tokio::process::Child,
	commit: String,
}

pub struct AgentHostManager {
	log: log::Logger,
	config: AgentHostConfig,
	platform: Platform,
	cache: DownloadCache,
	update_service: UpdateService,
	latest_release: Mutex<Option<(Instant, Release)>>,
	running: Mutex<Option<RunningServer>>,
	ready: Mutex<Option<Barrier<Result<PathBuf, String>>>>,
	management_socket_path: PathBuf,
	management_listener_started: AtomicBool,
	upgrade_in_progress: AtomicBool,
}

impl AgentHostManager {
	pub fn new(
		log: log::Logger,
		platform: Platform,
		cache: DownloadCache,
		http: BoxedHttp,
		config: AgentHostConfig,
	) -> Arc<Self> {
		Arc::new(Self {
			update_service: UpdateService::new(log.clone(), http),
			log,
			config,
			platform,
			cache,
			latest_release: Mutex::new(None),
			running: Mutex::new(None),
			ready: Mutex::new(None),
			management_socket_path: get_socket_name(),
			management_listener_started: AtomicBool::new(false),
			upgrade_in_progress: AtomicBool::new(false),
		})
	}

	async fn ensure_server(self: &Arc<Self>) -> Result<PathBuf, CodeError> {
		{
			let ready = self.ready.lock().await;
			if let Some(barrier) = &*ready {
				if barrier.is_open() {
					let running = self.running.lock().await;
					if running.is_some() {
						return barrier
							.clone()
							.wait()
							.await
							.unwrap()
							.map_err(CodeError::ServerDownloadError);
					}
				} else {
					let mut barrier = barrier.clone();
					drop(ready);
					return barrier
						.wait()
						.await
						.unwrap()
						.map_err(CodeError::ServerDownloadError);
				}
			}
		}

		self.start_server().await
	}

	async fn start_server(self: &Arc<Self>) -> Result<PathBuf, CodeError> {
		self.ensure_management_listener();

		let (release, server_dir) = self.get_cached_or_download().await?;

		let (mut barrier, opener) = new_barrier::<Result<PathBuf, String>>();
		{
			let mut ready = self.ready.lock().await;
			*ready = Some(barrier.clone());
		}

		let self_clone = self.clone();
		let release_clone = release.clone();
		tokio::spawn(async move {
			self_clone
				.run_server(release_clone, server_dir, opener)
				.await;
		});

		barrier
			.wait()
			.await
			.unwrap()
			.map_err(CodeError::ServerDownloadError)
	}

	async fn run_server(
		self: &Arc<Self>,
		release: Release,
		server_dir: PathBuf,
		opener: BarrierOpener<Result<PathBuf, String>>,
	) {
		let executable = if let Some(p) = option_env!("VSCODE_CLI_OVERRIDE_SERVER_PATH") {
			PathBuf::from(p)
		} else {
			server_dir
				.join(SERVER_FOLDER_NAME)
				.join("bin")
				.join(release.quality.server_entrypoint())
		};

		let agent_host_socket = get_socket_name();
		let mut cmd = new_script_command(&executable);
		cmd.stdin(std::process::Stdio::null());
		cmd.stderr(std::process::Stdio::piped());
		cmd.stdout(std::process::Stdio::piped());
		cmd.arg("--socket-path");
		cmd.arg(get_socket_name());
		cmd.arg("--agent-host-path");
		cmd.arg(&agent_host_socket);
		cmd.args([
			"--start-server",
			"--accept-server-license-terms",
			"--enable-remote-auto-shutdown",
		]);

		if let Some(a) = &self.config.server_data_dir {
			cmd.arg("--server-data-dir");
			cmd.arg(a);
		}
		if self.config.without_connection_token {
			cmd.arg("--without-connection-token");
		}
		if let Some(ct) = &self.config.connection_token_file {
			cmd.arg("--connection-token-file");
			cmd.arg(ct);
		}
		cmd.env(MANAGEMENT_SOCKET_ENV, &self.management_socket_path);
		cmd.env_remove("VSCODE_DEV");

		let mut child = match cmd.spawn() {
			Ok(c) => c,
			Err(e) => {
				opener.open(Err(e.to_string()));
				return;
			}
		};

		let commit_prefix = &release.commit[..release.commit.len().min(7)];
		let (mut stdout, mut stderr) = (
			BufReader::new(child.stdout.take().unwrap()).lines(),
			BufReader::new(child.stderr.take().unwrap()).lines(),
		);

		let mut opener = Some(opener);
		let socket_path = agent_host_socket.clone();
		let startup_deadline = tokio::time::sleep(STARTUP_TIMEOUT);
		tokio::pin!(startup_deadline);

		let mut ready = false;
		loop {
			tokio::select! {
				Ok(Some(l)) = stdout.next_line() => {
					debug!(self.log, "[{} stdout]: {}", commit_prefix, l);
					if !ready && l.contains("Agent host server listening on") {
						ready = true;
						if let Some(o) = opener.take() {
							o.open(Ok(socket_path.clone()));
						}
					}
				}
				Ok(Some(l)) = stderr.next_line() => {
					debug!(self.log, "[{} stderr]: {}", commit_prefix, l);
				}
				_ = &mut startup_deadline, if !ready => {
					warning!(self.log, "[{}]: Server did not become ready within {}s", commit_prefix, STARTUP_TIMEOUT.as_secs());
					if let Some(o) = opener.take() {
						o.open(Ok(socket_path.clone()));
					}
					ready = true;
				}
				e = child.wait() => {
					info!(self.log, "[{} process]: exited: {:?}", commit_prefix, e);
					if let Some(o) = opener.take() {
						o.open(Err(format!("Server exited before ready: {e:?}")));
					}
					return;
				}
			}

			if ready {
				break;
			}
		}

		{
			let mut running = self.running.lock().await;
			*running = Some(RunningServer {
				child,
				commit: release.commit.clone(),
			});
		}

		info!(self.log, "[{}]: Server ready", commit_prefix);

		let log = self.log.clone();
		let commit_prefix = commit_prefix.to_string();
		let self_clone = self.clone();
		tokio::spawn(async move {
			loop {
				tokio::select! {
					Ok(Some(l)) = stdout.next_line() => {
						debug!(log, "[{} stdout]: {}", commit_prefix, l);
					}
					Ok(Some(l)) = stderr.next_line() => {
						debug!(log, "[{} stderr]: {}", commit_prefix, l);
					}
					else => break,
				}
			}

			info!(log, "[{}]: Server process ended", commit_prefix);
			let mut running = self_clone.running.lock().await;
			if let Some(r) = &*running {
				if r.commit == commit_prefix || r.commit.starts_with(&commit_prefix) {
					*running = None;
				}
			}
		});
	}

	async fn get_cached_or_download(&self) -> Result<(Release, PathBuf), CodeError> {
		if option_env!("VSCODE_CLI_OVERRIDE_SERVER_PATH").is_some() {
			let release = Release {
				name: String::new(),
				commit: String::from("dev"),
				platform: self.platform,
				target: TargetKind::Server,
				quality: Quality::Insiders,
			};
			return Ok((release, PathBuf::new()));
		}

		if let Some((_, release)) = &*self.latest_release.lock().await {
			let name = get_server_folder_name(release.quality, &release.commit);
			if let Some(dir) = self.cache.exists(&name) {
				return Ok((release.clone(), dir));
			}
		}

		if self.latest_release.lock().await.is_none() && initial_agent_host_version().is_some() {
			let release = self.get_latest_release().await?;
			let dir = self.ensure_downloaded(&release).await?;
			return Ok((release, dir));
		}

		let quality = VSCODE_CLI_QUALITY
			.ok_or(CodeError::UpdatesNotConfigured("no configured quality"))
			.and_then(|q| {
				Quality::try_from(q).map_err(|_| CodeError::UpdatesNotConfigured("unknown quality"))
			})?;

		for entry in self.cache.get() {
			if let Some(dir) = self.cache.exists(&entry) {
				let (entry_quality, commit) = match entry.split_once('-') {
					Some((q, c)) => match Quality::try_from(q.to_lowercase().as_str()) {
						Ok(parsed) => (parsed, c.to_string()),
						Err(_) => (quality, entry.clone()),
					},
					None => (quality, entry.clone()),
				};
				let release = Release {
					name: String::new(),
					commit,
					platform: self.platform,
					target: TargetKind::Server,
					quality: entry_quality,
				};
				return Ok((release, dir));
			}
		}

		info!(self.log, "No cached server version, downloading latest...");
		let release = self.get_latest_release().await?;
		let dir = self.ensure_downloaded(&release).await?;
		Ok((release, dir))
	}

	pub async fn ensure_downloaded(&self, release: &Release) -> Result<PathBuf, CodeError> {
		let cache_name = get_server_folder_name(release.quality, &release.commit);
		if let Some(dir) = self.cache.exists(&cache_name) {
			return Ok(dir);
		}

		info!(self.log, "Downloading server {}", release.commit);
		let release = release.clone();
		let log = self.log.clone();
		let update_service = self.update_service.clone();
		self.cache
			.create(&cache_name, |target_dir| async move {
				let tmpdir = tempfile::tempdir().unwrap();
				let response = update_service.get_download_stream(&release).await?;
				let name = response.url_path_basename().unwrap();
				let archive_path = tmpdir.path().join(name);
				http::download_into_file(
					&archive_path,
					log.get_download_logger("Downloading server:"),
					response,
				)
				.await?;
				let server_dir = target_dir.join(SERVER_FOLDER_NAME);
				unzip_downloaded_release(&archive_path, &server_dir, SilentCopyProgress())?;
				Ok(())
			})
			.await
			.map_err(|e| CodeError::ServerDownloadError(e.to_string()))
	}

	pub async fn get_latest_release(&self) -> Result<Release, CodeError> {
		let mut latest = self.latest_release.lock().await;
		let now = Instant::now();

		let quality = VSCODE_CLI_QUALITY
			.ok_or(CodeError::UpdatesNotConfigured("no configured quality"))
			.and_then(|q| {
				Quality::try_from(q).map_err(|_| CodeError::UpdatesNotConfigured("unknown quality"))
			})?;

		if latest.is_none() {
			if let Some(commit) = initial_agent_host_version() {
				let release = Release {
					name: String::new(),
					commit,
					platform: self.platform,
					target: TargetKind::Server,
					quality,
				};
				info!(
					self.log,
					"Using initial agent host version override: {}", release.commit
				);
				*latest = Some((now, release.clone()));
				return Ok(release);
			}
		}

		let result = self
			.update_service
			.get_latest_commit(self.platform, TargetKind::Server, quality)
			.await
			.map_err(|e| CodeError::UpdateCheckFailed(e.to_string()));

		if let (Err(e), Some((_, previous))) = (&result, latest.clone()) {
			warning!(self.log, "Error checking for updates, using cached: {}", e);
			*latest = Some((now, previous.clone()));
			return Ok(previous);
		}

		let release = result?;
		debug!(self.log, "Resolved server version: {}", release);
		*latest = Some((now, release.clone()));
		Ok(release)
	}

	pub async fn run_update_loop(self: Arc<Self>) {
		let mut interval = tokio::time::interval(UPDATE_CHECK_INTERVAL);
		interval.tick().await;

		loop {
			interval.tick().await;

			let new_release = match self.get_latest_release().await {
				Ok(r) => r,
				Err(e) => {
					warning!(self.log, "Update check failed: {}", e);
					continue;
				}
			};

			let name = get_server_folder_name(new_release.quality, &new_release.commit);
			if self.cache.exists(&name).is_some() {
				continue;
			}

			info!(self.log, "New server version available: {}", new_release);

			loop {
				{
					let running = self.running.lock().await;
					if running.is_none() {
						break;
					}
				}
				debug!(self.log, "Server still running, waiting before updating...");
				tokio::time::sleep(UPDATE_POLL_INTERVAL).await;
			}

			match self.ensure_downloaded(&new_release).await {
				Ok(_) => info!(self.log, "Updated server to {}", new_release),
				Err(e) => warning!(self.log, "Failed to download update: {}", e),
			}
		}
	}

	pub async fn kill_running_server(&self) {
		let mut running = self.running.lock().await;
		if let Some(mut server) = running.take() {
			if let Some(pid) = server.child.id() {
				let _ = kill_tree(pid).await;
			}
			const REAP_TIMEOUT: Duration = Duration::from_secs(5);
			if tokio::time::timeout(REAP_TIMEOUT, server.child.wait())
				.await
				.is_err()
			{
				warning!(
					self.log,
					"Server did not exit within {}s after kill_tree; escalating to SIGKILL",
					REAP_TIMEOUT.as_secs()
				);
				let _ = server.child.kill().await;
				let _ = server.child.wait().await;
			}
		}
	}

	pub fn management_socket_path(&self) -> &PathBuf {
		&self.management_socket_path
	}

	pub fn ensure_management_listener(self: &Arc<Self>) {
		if self
			.management_listener_started
			.swap(true, Ordering::SeqCst)
		{
			return;
		}
		let self_clone = self.clone();
		tokio::spawn(async move {
			self_clone.run_management_listener().await;
		});
	}

	async fn run_management_listener(self: Arc<Self>) {
		let path = &self.management_socket_path;
		let mut listener = match listen_socket_rw_stream(path).await {
			Ok(l) => l,
			Err(e) => {
				warning!(self.log, "Failed to bind management socket {:?}: {}", path, e);
				self.management_listener_started
					.store(false, Ordering::SeqCst);
				return;
			}
		};
		debug!(self.log, "Listening for agent host management requests on {:?}", path);
		self.run_management_accept_loop(&mut listener).await;
	}

	async fn run_management_accept_loop(self: &Arc<Self>, listener: &mut AsyncPipeListener) {
		loop {
			let pipe = match listener.accept().await {
				Ok(p) => p,
				Err(e) => {
					warning!(self.log, "Management socket accept failed: {}", e);
					continue;
				}
			};
			let self_clone = self.clone();
			tokio::spawn(async move {
				let log = self_clone.log.clone();
				let io = TokioIo::new(pipe);
				let svc = service_fn(move |req| {
					let self_clone = self_clone.clone();
					async move { self_clone.handle_management_request(req).await }
				});
				if let Err(e) = ServerBuilder::new(TokioExecutor::new())
					.serve_connection(io, svc)
					.await
				{
					debug!(log, "Management connection ended: {:?}", e);
				}
			});
		}
	}

	async fn handle_management_request(
		self: Arc<Self>,
		req: Request<Incoming>,
	) -> Result<Response<HyperBody>, Infallible> {
		if req.method() == ::http::Method::POST && req.uri().path() == "/upgrade" {
			return Ok(self.handle_upgrade_request().await);
		}
		Ok(Response::builder()
			.status(404)
			.body(full_body("Not found"))
			.unwrap())
	}

	async fn handle_upgrade_request(self: Arc<Self>) -> Response<HyperBody> {
		let running_commit = {
			let running = self.running.lock().await;
			running.as_ref().map(|r| r.commit.clone())
		};

		let new_release = match self.get_latest_release().await {
			Ok(r) => r,
			Err(e) => {
				warning!(self.log, "Upgrade request: latest release lookup failed: {}", e);
				return json_response(
					503,
					&UpgradeResponse {
						ok: false,
						upgrade_needed: None,
						upgrade_started: None,
						running_commit,
						latest_commit: None,
						restart_delay_ms: None,
						error: Some(format!("Failed to check for updates: {e}")),
					},
				);
			}
		};

		let upgrade_needed = match &running_commit {
			Some(c) => *c != new_release.commit,
			None => true,
		};

		if !upgrade_needed {
			return json_response(
				200,
				&UpgradeResponse {
					ok: true,
					upgrade_needed: Some(false),
					upgrade_started: Some(false),
					running_commit,
					latest_commit: Some(new_release.commit.clone()),
					restart_delay_ms: None,
					error: None,
				},
			);
		}

		if self.upgrade_in_progress.swap(true, Ordering::SeqCst) {
			return json_response(
				200,
				&UpgradeResponse {
					ok: true,
					upgrade_needed: Some(true),
					upgrade_started: Some(false),
					running_commit,
					latest_commit: Some(new_release.commit.clone()),
					restart_delay_ms: None,
					error: Some("An upgrade is already in progress.".to_string()),
				},
			);
		}

		if let Err(e) = self.ensure_downloaded(&new_release).await {
			warning!(self.log, "Failed to download upgrade {}: {}", new_release, e);
			self.upgrade_in_progress.store(false, Ordering::SeqCst);
			return json_response(
				503,
				&UpgradeResponse {
					ok: false,
					upgrade_needed: Some(true),
					upgrade_started: Some(false),
					running_commit,
					latest_commit: Some(new_release.commit.clone()),
					restart_delay_ms: None,
					error: Some(format!("Failed to download upgrade: {e}")),
				},
			);
		}

		let self_clone = self.clone();
		let release_commit = new_release.commit.clone();
		tokio::spawn(async move {
			tokio::time::sleep(UPGRADE_KILL_DELAY).await;
			self_clone.kill_running_server().await;
			match self_clone.start_server().await {
				Ok(_) => info!(self_clone.log, "Restarted agent host on {}", release_commit),
				Err(e) => warning!(self_clone.log, "Failed to restart agent host after upgrade: {}", e),
			}
			self_clone.upgrade_in_progress.store(false, Ordering::SeqCst);
		});

		json_response(
			200,
			&UpgradeResponse {
				ok: true,
				upgrade_needed: Some(true),
				upgrade_started: Some(true),
				running_commit,
				latest_commit: Some(new_release.commit.clone()),
				restart_delay_ms: Some(UPGRADE_KILL_DELAY.as_millis() as u64),
				error: None,
			},
		)
	}
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
struct UpgradeResponse {
	ok: bool,
	#[serde(rename = "upgradeNeeded", skip_serializing_if = "Option::is_none")]
	upgrade_needed: Option<bool>,
	#[serde(rename = "upgradeStarted", skip_serializing_if = "Option::is_none")]
	upgrade_started: Option<bool>,
	#[serde(rename = "runningCommit", skip_serializing_if = "Option::is_none")]
	running_commit: Option<String>,
	#[serde(rename = "latestCommit", skip_serializing_if = "Option::is_none")]
	latest_commit: Option<String>,
	#[serde(rename = "restartDelayMs", skip_serializing_if = "Option::is_none")]
	restart_delay_ms: Option<u64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	error: Option<String>,
}

fn json_response<T: Serialize>(status: u16, body: &T) -> Response<HyperBody> {
	let serialized = serde_json::to_string(body).unwrap_or_else(|_| "{}".to_string());
	Response::builder()
		.status(status)
		.header("content-type", "application/json")
		.body(full_body(serialized))
		.unwrap()
}


pub async fn handle_request(
	manager: Arc<AgentHostManager>,
	req: Request<Incoming>,
) -> Result<Response<HyperBody>, Infallible> {
	let socket_path = match manager.ensure_server().await {
		Ok(p) => p,
		Err(e) => {
			error!(manager.log, "Error starting agent host: {:?}", e);
			return Ok(Response::builder()
				.status(503)
				.body(full_body(format!("Error starting agent host: {e:?}")))
				.unwrap());
		}
	};

	let is_upgrade = req.headers().contains_key(::http::header::UPGRADE);

	let rw = match get_socket_rw_stream(&socket_path).await {
		Ok(rw) => rw,
		Err(e) => {
			error!(
				manager.log,
				"Error connecting to agent host socket: {:?}", e
			);
			return Ok(Response::builder()
				.status(503)
				.body(full_body(format!("Error connecting to agent host: {e:?}")))
				.unwrap());
		}
	};

	if is_upgrade {
		Ok(forward_ws_to_server(manager.log.clone(), rw, req).await)
	} else {
		Ok(forward_http_to_server(rw, req).await)
	}
}

async fn forward_http_to_server<T>(rw: T, req: Request<Incoming>) -> Response<HyperBody>
where
	T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
	let (mut request_sender, connection) =
		match hyper::client::conn::http1::handshake(TokioIo::new(rw)).await {
			Ok(r) => r,
			Err(e) => return connection_err(e),
		};

	tokio::spawn(connection);

	match request_sender.send_request(req).await {
		Ok(res) => res.map(|b| b.boxed()),
		Err(e) => connection_err(e),
	}
}

async fn forward_ws_to_server<T>(
	log: log::Logger,
	rw: T,
	mut req: Request<Incoming>,
) -> Response<HyperBody>
where
	T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
	let (mut request_sender, connection) =
		match hyper::client::conn::http1::handshake(TokioIo::new(rw)).await {
			Ok(r) => r,
			Err(e) => return connection_err(e),
		};

	tokio::spawn(connection.with_upgrades());

	let mut proxied_req = Request::builder().uri(req.uri());
	for (k, v) in req.headers() {
		proxied_req = proxied_req.header(k, v);
	}

	let mut res = match request_sender
		.send_request(
			proxied_req
				.body(http_body_util::Empty::<bytes::Bytes>::new())
				.unwrap(),
		)
		.await
	{
		Ok(r) => r,
		Err(e) => return connection_err(e),
	};

	let mut proxied_res = Response::new(empty_body());
	*proxied_res.status_mut() = res.status();
	for (k, v) in res.headers() {
		proxied_res.headers_mut().insert(k, v.clone());
	}

	if res.status() == ::http::StatusCode::SWITCHING_PROTOCOLS {
		tokio::spawn(async move {
			let (s_req, s_res) =
				tokio::join!(hyper::upgrade::on(&mut req), hyper::upgrade::on(&mut res));

			match (s_req, s_res) {
				(Ok(s_req), Ok(s_res)) => {
					let mut s_req = TokioIo::new(s_req);
					let mut s_res = TokioIo::new(s_res);
					if let Err(e) = tokio::io::copy_bidirectional(&mut s_req, &mut s_res).await {
						debug!(log, "Agent host WebSocket proxy ended with error: {:?}", e);
					}
				}
				(Err(e), _) => {
					warning!(
						log,
						"Agent host client-side WebSocket upgrade failed: {:?}",
						e
					);
				}
				(_, Err(e)) => {
					warning!(
						log,
						"Agent host server-side WebSocket upgrade failed: {:?}",
						e
					);
				}
			}
		});
	}

	proxied_res
}

fn connection_err(err: hyper::Error) -> Response<HyperBody> {
	Response::builder()
		.status(503)
		.body(full_body(format!(
			"Error connecting to agent host: {err:?}"
		)))
		.unwrap()
}


pub struct AgentHostSidecar {
	log: log::Logger,
	manager: Arc<AgentHostManager>,
	listener: TcpListener,
	bound_addr: SocketAddr,
	public_token: Option<String>,
	lockfile_path: PathBuf,
	pid: u32,
}

impl AgentHostSidecar {
	pub async fn bind_tcp(
		log: log::Logger,
		manager: Arc<AgentHostManager>,
		addr: SocketAddr,
		host_label: Option<String>,
		loopback_auth: LoopbackAuth,
		tunnel_name: Option<String>,
		lockfile_path: PathBuf,
	) -> Result<Arc<Self>, AnyError> {
		let public_token = loopback_auth.into_token();
		let listener = TcpListener::bind(addr)
			.await
			.map_err(CodeError::CouldNotListenOnInterface)?;
		let bound_addr = listener
			.local_addr()
			.map_err(CodeError::CouldNotListenOnInterface)?;

		let pid = std::process::id();
		let host = host_label.unwrap_or_else(|| bound_addr.ip().to_string());
		let metadata = build_metadata(
			pid,
			host,
			bound_addr.port(),
			public_token.clone(),
			tunnel_name.as_deref(),
		);
		if let Err(e) = write_agent_host_metadata(&lockfile_path, &metadata) {
			warning!(log, "Failed to write agent host lockfile: {}", e);
		}

		Ok(Arc::new(Self {
			log,
			manager,
			listener,
			bound_addr,
			public_token,
			lockfile_path,
			pid,
		}))
	}

	pub fn manager(&self) -> Arc<AgentHostManager> {
		self.manager.clone()
	}

	pub fn bound_addr(&self) -> SocketAddr {
		self.bound_addr
	}

	pub async fn serve(&self, mut shutdown: Barrier<ShutdownSignal>) -> Result<(), AnyError> {
		loop {
			tokio::select! {
				_ = shutdown.wait() => return Ok(()),
				accepted = self.listener.accept() => {
					let (stream, _) = match accepted {
						Ok(v) => v,
						Err(e) => {
							warning!(self.log, "Failed to accept connection: {}", e);
							continue;
						}
					};
					let mgr = self.manager.clone();
					let token = self.public_token.clone();
					tokio::spawn(async move {
						let io = TokioIo::new(stream);
						let svc = service_fn(move |req| {
							let mgr = mgr.clone();
							let token = token.clone();
							async move { handle_request_with_auth(mgr, req, token).await }
						});
						if let Err(e) = ServerBuilder::new(TokioExecutor::new())
							.serve_connection_with_upgrades(io, svc)
							.await
						{
							let _ = e;
						}
					});
				}
			}
		}
	}

	pub async fn serve_tunnel_connection<RW>(&self, rw: RW)
	where
		RW: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
	{
		debug!(self.log, "Serving tunnel agent host connection");
		let mgr = self.manager.clone();
		let svc = service_fn(move |req| {
			let mgr = mgr.clone();
			async move { handle_request(mgr, req).await }
		});
		let io = TokioIo::new(rw);
		if let Err(e) = ServerBuilder::new(TokioExecutor::new())
			.serve_connection_with_upgrades(io, svc)
			.await
		{
			debug!(self.log, "Tunnel agent host connection ended: {:?}", e);
		}
	}

	pub async fn shutdown(&self) {
		self.manager.kill_running_server().await;
		if let Err(e) = remove_agent_host_metadata_for_pid(&self.lockfile_path, self.pid) {
			warning!(self.log, "Failed to clean up agent host lockfile: {}", e);
		}
	}
}

impl Drop for AgentHostSidecar {
	fn drop(&mut self) {
		let _ = remove_agent_host_metadata_for_pid(&self.lockfile_path, self.pid);
	}
}

fn build_metadata(
	pid: u32,
	host: String,
	port: u16,
	connection_token: Option<String>,
	tunnel_name: Option<&str>,
) -> AgentHostMetadata {
	let mut metadata = AgentHostMetadata::new(pid, port);
	metadata.host = Some(host);
	metadata.connection_token = connection_token;
	metadata.quality = VSCODE_CLI_QUALITY.map(str::to_string);
	metadata.tunnel_name = tunnel_name.map(str::to_string);
	metadata
}

pub enum LoopbackAuth {
	Token(String),
	Disabled,
}

impl LoopbackAuth {
	fn into_token(self) -> Option<String> {
		match self {
			LoopbackAuth::Token(t) => Some(t),
			LoopbackAuth::Disabled => None,
		}
	}
}

async fn handle_request_with_auth(
	manager: Arc<AgentHostManager>,
	req: Request<Incoming>,
	expected_token: Option<String>,
) -> Result<Response<HyperBody>, Infallible> {
	if let Some(ref token) = expected_token {
		let uri_query = req.uri().query().unwrap_or("");
		let has_valid_token = url::form_urlencoded::parse(uri_query.as_bytes())
			.any(|(k, v)| k == "tkn" && v == token.as_str());

		if !has_valid_token {
			return Ok(Response::builder()
				.status(403)
				.body(full_body("Forbidden: missing or invalid connection token"))
				.unwrap());
		}
	}

	handle_request(manager, req).await
}


#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentHostLockfileDecision {
	SpawnFresh,
	Reuse {
		pid: u32,
		host: Option<String>,
		port: u16,
		token: Option<String>,
		tunnel_name: Option<String>,
	},
}

pub fn classify_agent_host_lockfile(
	log: &log::Logger,
	path: &std::path::Path,
) -> AgentHostLockfileDecision {
	use super::agent_host_metadata::read_agent_host_metadata;
	use crate::util::machine::process_exists;

	let metadata = match read_agent_host_metadata(path) {
		Ok(Some(m)) => m,
		Ok(None) => return AgentHostLockfileDecision::SpawnFresh,
		Err(e) => {
			debug!(
				log,
				"Could not read agent host lockfile {}: {}",
				path.display(),
				e
			);
			return AgentHostLockfileDecision::SpawnFresh;
		}
	};

	if !process_exists(metadata.pid) {
		debug!(
			log,
			"Agent host lockfile {} references dead PID {}; treating as stale",
			path.display(),
			metadata.pid
		);
		return AgentHostLockfileDecision::SpawnFresh;
	}

	AgentHostLockfileDecision::Reuse {
		pid: metadata.pid,
		host: metadata.host,
		port: metadata.port,
		token: metadata.connection_token,
		tunnel_name: metadata.tunnel_name,
	}
}

pub async fn forward_tunnel_connection_to_existing_ah<RW>(
	log: log::Logger,
	rw: RW,
	upstream_host: String,
	upstream_port: u16,
	token: Option<String>,
) where
	RW: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
	let token = Arc::new(token);
	let upstream_host = Arc::new(upstream_host);
	let svc_log = log.clone();
	let svc = service_fn(move |req| {
		let log = svc_log.clone();
		let token = token.clone();
		let host = upstream_host.clone();
		async move {
			handle_reuse_request(log, (*host).clone(), upstream_port, (*token).clone(), req).await
		}
	});
	let io = TokioIo::new(rw);
	if let Err(e) = ServerBuilder::new(TokioExecutor::new())
		.serve_connection_with_upgrades(io, svc)
		.await
	{
		debug!(log, "Tunnel reuse-forward connection ended: {:?}", e);
	}
}

async fn handle_reuse_request(
	log: log::Logger,
	upstream_host: String,
	upstream_port: u16,
	token: Option<String>,
	mut req: Request<Incoming>,
) -> Result<Response<HyperBody>, Infallible> {
	if let Some(ref tok) = token {
		let new_uri = inject_connection_token(req.uri(), tok);
		*req.uri_mut() = new_uri;
	}

	let target = format!("{upstream_host}:{upstream_port}");
	let stream = match tokio::net::TcpStream::connect(&target).await {
		Ok(s) => s,
		Err(e) => {
			warning!(
				log,
				"Failed to connect to existing agent host on {}: {}",
				target,
				e
			);
			return Ok(Response::builder()
				.status(503)
				.body(full_body(format!(
					"Error connecting to existing agent host: {e}"
				)))
				.unwrap());
		}
	};

	let is_upgrade = req.headers().contains_key(::http::header::UPGRADE);
	if is_upgrade {
		Ok(forward_ws_to_server(log, stream, req).await)
	} else {
		Ok(forward_http_to_server(stream, req).await)
	}
}

fn inject_connection_token(uri: &::http::Uri, token: &str) -> ::http::Uri {
	let path = uri.path();
	let path = if path.is_empty() { "/" } else { path };
	let encoded: String = url::form_urlencoded::byte_serialize(token.as_bytes()).collect();
	let new_path_and_query = match uri.query() {
		Some(q) if !q.is_empty() => format!("{path}?{q}&tkn={encoded}"),
		_ => format!("{path}?tkn={encoded}"),
	};
	::http::Uri::builder()
		.path_and_query(new_path_and_query.as_str())
		.build()
		.unwrap_or_else(|_| uri.clone())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::tunnels::agent_host_metadata::{
		read_agent_host_metadata, AGENT_HOST_PROTOCOL_VERSION,
	};
	use crate::util::http::ReqwestSimpleHttp;
	use std::path::Path;

	fn make_test_manager(cache_dir: &Path) -> Arc<AgentHostManager> {
		AgentHostManager::new(
			log::Logger::test(),
			Platform::LinuxX64,
			DownloadCache::new(cache_dir.to_path_buf()),
			Arc::new(ReqwestSimpleHttp::new()),
			AgentHostConfig {
				server_data_dir: None,
				without_connection_token: true,
				connection_token: None,
				connection_token_file: None,
			},
		)
	}

	#[tokio::test]
	async fn management_listener_returns_404_for_unknown_paths() {
		let dir = tempfile::tempdir().unwrap();
		let manager = make_test_manager(dir.path());
		let socket_path = manager.management_socket_path().clone();
		manager.ensure_management_listener();
		tokio::time::sleep(Duration::from_millis(50)).await;

		let pipe = get_socket_rw_stream(&socket_path).await.expect("connect");
		let io = TokioIo::new(pipe);
		let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await.unwrap();
		tokio::spawn(async move {
			let _ = conn.await;
		});
		let req = Request::builder()
			.method("GET")
			.uri("/nope")
			.body(http_body_util::Empty::<bytes::Bytes>::new())
			.unwrap();
		let res = sender.send_request(req).await.expect("send");
		assert_eq!(res.status(), 404);
	}

	#[test]
	fn ensure_management_listener_is_idempotent() {
		let dir = tempfile::tempdir().unwrap();
		let manager = make_test_manager(dir.path());
		assert!(!manager
			.management_listener_started
			.swap(true, Ordering::SeqCst));
		assert!(manager
			.management_listener_started
			.swap(true, Ordering::SeqCst));
	}

	#[test]
	fn upgrade_response_serializes_compactly() {
		let resp = UpgradeResponse {
			ok: true,
			upgrade_needed: Some(false),
			upgrade_started: Some(false),
			running_commit: Some("abc123".into()),
			latest_commit: Some("abc123".into()),
			restart_delay_ms: None,
			error: None,
		};
		let json = serde_json::to_string(&resp).unwrap();
		assert_eq!(
			json,
			r#"{"ok":true,"upgradeNeeded":false,"upgradeStarted":false,"runningCommit":"abc123","latestCommit":"abc123"}"#
		);
	}

	#[test]
	fn upgrade_response_omits_empty_fields() {
		let resp = UpgradeResponse {
			ok: false,
			upgrade_needed: None,
			upgrade_started: None,
			running_commit: None,
			latest_commit: None,
			restart_delay_ms: None,
			error: Some("boom".into()),
		};
		let json = serde_json::to_string(&resp).unwrap();
		assert_eq!(json, r#"{"ok":false,"error":"boom"}"#);
	}

	#[test]
	fn upgrade_response_includes_restart_delay_when_set() {
		let resp = UpgradeResponse {
			ok: true,
			upgrade_needed: Some(true),
			upgrade_started: Some(true),
			running_commit: Some("old".into()),
			latest_commit: Some("new".into()),
			restart_delay_ms: Some(3000),
			error: None,
		};
		let json = serde_json::to_string(&resp).unwrap();
		assert!(json.contains(r#""restartDelayMs":3000"#), "got: {}", json);
	}

	#[test]
	fn metadata_includes_quality_and_no_tunnel() {
		let metadata = build_metadata(
			42,
			"127.0.0.1".to_string(),
			8080,
			Some("tok".to_string()),
			None,
		);

		assert_eq!(metadata.pid, 42);
		assert_eq!(metadata.host.as_deref(), Some("127.0.0.1"));
		assert_eq!(metadata.port, 8080);
		assert_eq!(metadata.connection_token.as_deref(), Some("tok"));
		assert_eq!(metadata.protocol_version, AGENT_HOST_PROTOCOL_VERSION);
		assert_eq!(metadata.tunnel_name, None);
	}

	#[test]
	fn metadata_records_tunnel_name() {
		let metadata = build_metadata(42, "0.0.0.0".to_string(), 8080, None, Some("my-tunnel"));

		assert_eq!(metadata.host.as_deref(), Some("0.0.0.0"));
		assert_eq!(metadata.tunnel_name.as_deref(), Some("my-tunnel"));
	}

	#[tokio::test]
	async fn bind_tcp_writes_lockfile_with_bound_port_and_pid() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("agent-host.lock");
		let manager = make_test_manager(dir.path());

		let sidecar = AgentHostSidecar::bind_tcp(
			log::Logger::test(),
			manager,
			SocketAddr::from(([127, 0, 0, 1], 0)),
			Some("localhost".to_string()),
			LoopbackAuth::Token("tok".to_string()),
			Some("my-tunnel".to_string()),
			lockfile.clone(),
		)
		.await
		.unwrap();

		let metadata = read_agent_host_metadata(&lockfile).unwrap().unwrap();
		assert_eq!(metadata.pid, std::process::id());
		assert_eq!(metadata.host.as_deref(), Some("localhost"));
		assert_eq!(metadata.port, sidecar.bound_addr().port());
		assert_ne!(metadata.port, 0);
		assert_eq!(metadata.connection_token.as_deref(), Some("tok"));
		assert_eq!(metadata.tunnel_name.as_deref(), Some("my-tunnel"));
	}

	#[tokio::test]
	async fn drop_removes_lockfile_when_pid_matches() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("agent-host.lock");
		let manager = make_test_manager(dir.path());

		{
			let _sidecar = AgentHostSidecar::bind_tcp(
				log::Logger::test(),
				manager,
				SocketAddr::from(([127, 0, 0, 1], 0)),
				None,
				LoopbackAuth::Disabled,
				None,
				lockfile.clone(),
			)
			.await
			.unwrap();
			assert!(lockfile.exists());
		}

		assert!(!lockfile.exists());
	}

	#[tokio::test]
	async fn shutdown_leaves_lockfile_when_pid_was_overwritten() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("agent-host.lock");
		let manager = make_test_manager(dir.path());

		let sidecar = AgentHostSidecar::bind_tcp(
			log::Logger::test(),
			manager,
			SocketAddr::from(([127, 0, 0, 1], 0)),
			None,
			LoopbackAuth::Disabled,
			None,
			lockfile.clone(),
		)
		.await
		.unwrap();

		let foreign_pid = std::process::id().wrapping_add(1);
		write_agent_host_metadata(&lockfile, &AgentHostMetadata::new(foreign_pid, 9999)).unwrap();

		sidecar.shutdown().await;

		let preserved = read_agent_host_metadata(&lockfile).unwrap().unwrap();
		assert_eq!(preserved.pid, foreign_pid);
		assert_eq!(preserved.port, 9999);
	}

	#[test]
	fn classify_returns_spawn_fresh_when_lockfile_missing() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("missing.lock");

		let decision = classify_agent_host_lockfile(&log::Logger::test(), &lockfile);

		assert_eq!(decision, AgentHostLockfileDecision::SpawnFresh);
	}

	#[test]
	fn classify_returns_spawn_fresh_for_stale_pid() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("agent-host.lock");
		let mut metadata = AgentHostMetadata::new(u32::MAX - 1, 1234);
		metadata.connection_token = Some("ignored".to_string());
		write_agent_host_metadata(&lockfile, &metadata).unwrap();

		let decision = classify_agent_host_lockfile(&log::Logger::test(), &lockfile);

		assert_eq!(decision, AgentHostLockfileDecision::SpawnFresh);
	}

	#[test]
	fn classify_returns_reuse_for_live_compatible_lockfile() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("agent-host.lock");
		let pid = std::process::id();
		let mut metadata = AgentHostMetadata::new(pid, 4321);
		metadata.host = Some("127.0.0.1".to_string());
		metadata.connection_token = Some("tok".to_string());
		write_agent_host_metadata(&lockfile, &metadata).unwrap();

		let decision = classify_agent_host_lockfile(&log::Logger::test(), &lockfile);

		assert_eq!(
			decision,
			AgentHostLockfileDecision::Reuse {
				pid,
				host: Some("127.0.0.1".to_string()),
				port: 4321,
				token: Some("tok".to_string()),
				tunnel_name: None,
			}
		);
	}

	#[test]
	fn classify_returns_reuse_for_live_newer_protocol() {
		let dir = tempfile::tempdir().unwrap();
		let lockfile = dir.path().join("agent-host.lock");
		let pid = std::process::id();
		let mut metadata = AgentHostMetadata::new(pid, 4321);
		metadata.protocol_version = "9.9.9".to_string();
		metadata.connection_token = Some("tok".to_string());
		write_agent_host_metadata(&lockfile, &metadata).unwrap();

		let decision = classify_agent_host_lockfile(&log::Logger::test(), &lockfile);

		assert_eq!(
			decision,
			AgentHostLockfileDecision::Reuse {
				pid,
				host: None,
				port: 4321,
				token: Some("tok".to_string()),
				tunnel_name: None,
			}
		);
	}

	#[test]
	fn inject_connection_token_appends_when_no_query() {
		let uri: ::http::Uri = "/path".parse().unwrap();
		let out = inject_connection_token(&uri, "abc def");
		assert_eq!(out.path_and_query().unwrap().as_str(), "/path?tkn=abc+def");
	}

	#[test]
	fn inject_connection_token_appends_when_query_present() {
		let uri: ::http::Uri = "/path?foo=bar".parse().unwrap();
		let out = inject_connection_token(&uri, "tok");
		assert_eq!(
			out.path_and_query().unwrap().as_str(),
			"/path?foo=bar&tkn=tok"
		);
	}

	#[test]
	fn inject_connection_token_handles_empty_path() {
		let uri: ::http::Uri = "/".parse().unwrap();
		let out = inject_connection_token(&uri, "tok");
		assert_eq!(out.path_and_query().unwrap().as_str(), "/?tkn=tok");
	}
}
