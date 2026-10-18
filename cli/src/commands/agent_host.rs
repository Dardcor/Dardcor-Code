/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};

use crate::auth::Auth;
use crate::constants::{self, AGENT_HOST_PORT};
use crate::log;
use crate::state::LauncherPaths;
use crate::tunnels::agent_host::{
	classify_agent_host_lockfile, AgentHostConfig, AgentHostLockfileDecision, AgentHostManager,
	AgentHostSidecar, LoopbackAuth,
};
use crate::tunnels::agent_host_metadata::remove_agent_host_metadata;
use crate::tunnels::code_server::CodeServerArgs;
use crate::tunnels::dev_tunnels::DevTunnels;
use crate::tunnels::shutdown_signal::ShutdownRequest;
use crate::update_service::Platform;
use crate::util::command::{kill_tree, DetachFromParent};
use crate::util::errors::{wrap, AnyError, CodeError};
use crate::util::http::ReqwestSimpleHttp;
use crate::util::prereqs::PreReqChecker;

use super::args::AgentHostArgs;
use super::output;
use super::tunnels::fulfill_existing_tunnel_args;
use super::CommandContext;

const SUPERVISOR_ENV: &str = "VSCODE_AGENT_HOST_SUPERVISOR";
const SUPERVISOR_READY_LINE: &str = "__VSCODE_AGENT_HOST_READY__";
const SUPERVISOR_READY_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub async fn agent_host(ctx: CommandContext, args: AgentHostArgs) -> Result<i32, AnyError> {
	if std::env::var_os(SUPERVISOR_ENV).is_some() {
		return run_supervisor(ctx, args).await;
	}
	run_foreground(ctx, args).await
}

async fn run_foreground(ctx: CommandContext, args: AgentHostArgs) -> Result<i32, AnyError> {
	let started = Instant::now();
	let lockfile_path = ctx.paths.agent_host_lockfile();

	let decision = classify_agent_host_lockfile(&ctx.log, &lockfile_path);

	if let AgentHostLockfileDecision::Reuse {
		pid,
		host,
		port,
		token,
		tunnel_name,
	} = &decision
	{
		if args.replace {
			info!(
				ctx.log,
				"--replace set; stopping agent host (PID {}, port {}) before starting new one",
				pid,
				port
			);
			replace_existing(&ctx.log, &lockfile_path, *pid).await?;
			return daemonize_supervisor(&args).await;
		}

		if let Some(conflict) = detect_config_conflict(
			&args,
			host.as_deref(),
			*port,
			token.as_deref(),
			tunnel_name.as_deref(),
		) {
			ctx.log.result(format!(
				"Agent host already running on {host_str}:{port} (PID {pid}), but {conflict}.\n\
				 Use `code agent kill` to stop it, or pass `--replace` to take over.",
				host_str = host.as_deref().unwrap_or("127.0.0.1"),
			));
			return Ok(2);
		}

		print_reuse_banner(
			&ctx.log,
			started,
			*pid,
			host.as_deref(),
			*port,
			token.as_deref(),
			tunnel_name.as_deref(),
		);
		return Ok(0);
	}

	daemonize_supervisor(&args).await
}

async fn run_supervisor(mut ctx: CommandContext, mut args: AgentHostArgs) -> Result<i32, AnyError> {
	let started = Instant::now();

	let log_file = ctx.paths.agent_host_log_file();
	if let Some(parent) = log_file.parent() {
		let _ = fs::create_dir_all(parent);
	}
	match log::FileLogSink::new(log::Level::Trace, &log_file) {
		Ok(sink) => {
			ctx.log = ctx.log.tee(sink);
			info!(
				ctx.log,
				"Agent host supervisor logging to {}",
				log_file.display()
			);
		}
		Err(e) => {
			warning!(
				ctx.log,
				"Failed to open agent host supervisor log file {}: {}",
				log_file.display(),
				e
			);
		}
	}

	let platform: Platform = PreReqChecker::new().verify().await?;

	if !args.without_connection_token {
		if let Some(p) = args.connection_token_file.as_deref() {
			let token = fs::read_to_string(PathBuf::from(p))
				.map_err(CodeError::CouldNotReadConnectionTokenFile)?;
			args.connection_token = Some(token.trim().to_string());
		} else {
			let token_path = ctx.paths.root().join("agent-host-token");
			let token = mint_connection_token(&token_path, args.connection_token.clone())
				.map_err(CodeError::CouldNotCreateConnectionTokenFile)?;
			args.connection_token = Some(token);
			args.connection_token_file = Some(token_path.to_string_lossy().to_string());
		}
	}

	let manager = AgentHostManager::new(
		ctx.log.clone(),
		platform,
		ctx.paths.server_cache.clone(),
		Arc::new(ReqwestSimpleHttp::with_client(ctx.http.clone())),
		AgentHostConfig {
			server_data_dir: args.server_data_dir.clone(),
			without_connection_token: true,
			connection_token: None,
			connection_token_file: None,
		},
	);

	if option_env!("VSCODE_CLI_OVERRIDE_SERVER_PATH").is_none() {
		match manager.get_latest_release().await {
			Ok(release) => {
				if let Err(e) = manager.ensure_downloaded(&release).await {
					warning!(ctx.log, "Error downloading latest server version: {}", e);
				}
			}
			Err(e) => warning!(ctx.log, "Error resolving initial server version: {}", e),
		}

		let manager_for_updates = manager.clone();
		tokio::spawn(async move {
			manager_for_updates.run_update_loop().await;
		});
	}

	let mut pending_tunnel = None;
	let mut tunnel_name: Option<String> = None;
	if args.tunnel {
		let mut auth = Auth::new(&ctx.paths, ctx.log.clone());
		auth.set_provider(crate::auth::AuthProvider::Github);
		let mut dt = DevTunnels::new_remote_tunnel(&ctx.log, auth, &ctx.paths);

		let mut tunnel = if let Some(existing) =
			fulfill_existing_tunnel_args(args.existing_tunnel.clone(), &args.name)
		{
			dt.start_existing_tunnel(existing).await
		} else {
			dt.start_new_launcher_tunnel(args.name.as_deref(), args.random_name, &[])
				.await
		}?;

		tunnel_name = Some(tunnel.name.clone());
		let tunnel_port = tunnel.add_port_direct(AGENT_HOST_PORT).await?;
		pending_tunnel = Some((tunnel, tunnel_port));
	}

	let listen_addr = resolve_listen_addr(&args)?;
	let loopback_auth = match args.connection_token.as_deref() {
		Some(t) => LoopbackAuth::Token(t.to_string()),
		None => LoopbackAuth::Disabled,
	};

	let sidecar = AgentHostSidecar::bind_tcp(
		ctx.log.clone(),
		manager.clone(),
		listen_addr,
		args.host.clone(),
		loopback_auth,
		tunnel_name.clone(),
		ctx.paths.agent_host_lockfile(),
	)
	.await?;
	let bound_port = sidecar.bound_addr().port();

	let mut tunnel_handle: Option<crate::tunnels::dev_tunnels::ActiveTunnel> = None;
	if let Some((tunnel, mut tunnel_port)) = pending_tunnel {
		let sidecar_for_tunnel = sidecar.clone();
		tokio::spawn(async move {
			while let Some(socket) = tunnel_port.recv().await {
				let sidecar = sidecar_for_tunnel.clone();
				tokio::spawn(async move {
					sidecar.serve_tunnel_connection(socket.into_rw()).await;
				});
			}
		});
		tunnel_handle = Some(tunnel);
	}

	let product = constants::QUALITYLESS_PRODUCT_NAME;
	let token_suffix = args
		.connection_token
		.as_deref()
		.map(|t| format!("?tkn={t}"))
		.unwrap_or_default();

	output::print_banner_header(&format!("{product} Agent Host"), started.elapsed());
	if let (Some(base), Some(name)) = (constants::EDITOR_WEB_URL, &tunnel_name) {
		output::print_banner_line("Tunnel", &format!("{base}/agents/tunnel/{name}"));
	}
	let banner_listen_ip = args
		.host
		.as_deref()
		.and_then(|h| h.parse::<std::net::IpAddr>().ok())
		.unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
	output::print_network_lines(bound_port, banner_listen_ip, &token_suffix);
	output::print_banner_line("Manage", "code agent ps  |  code agent kill");
	output::print_banner_footer();
	let _ = std::io::stdout().flush();

	println!("{SUPERVISOR_READY_LINE}");
	let _ = std::io::stdout().flush();
	let _ = std::io::stderr().flush();
	if let Err(e) = redirect_stdio_to_null() {
		warning!(ctx.log, "Failed to redirect stdio after detach: {}", e);
	}

	let shutdown_rx = ShutdownRequest::create_rx([ShutdownRequest::CtrlC]);
	sidecar.serve(shutdown_rx).await?;
	sidecar.shutdown().await;

	if let Some(mut tunnel) = tunnel_handle.take() {
		tunnel.close().await.ok();
	}

	Ok(0)
}

fn resolve_listen_addr(args: &AgentHostArgs) -> Result<SocketAddr, AnyError> {
	let host = args.host.as_deref().unwrap_or("127.0.0.1");
	let ip: std::net::IpAddr = match host.parse() {
		Ok(ip) => ip,
		Err(_) => match (host, 0).to_socket_addrs() {
			Ok(mut iter) => match iter.next() {
				Some(addr) => addr.ip(),
				None => {
					return Err(CodeError::CouldNotListenOnInterface(std::io::Error::new(
						std::io::ErrorKind::InvalidInput,
						format!("could not resolve --host '{host}'"),
					))
					.into())
				}
			},
			Err(e) => return Err(wrap(e, format!("could not resolve --host '{host}'")).into()),
		},
	};
	Ok(SocketAddr::new(ip, args.port))
}

fn print_reuse_banner(
	log: &log::Logger,
	started: Instant,
	pid: u32,
	host: Option<&str>,
	port: u16,
	token: Option<&str>,
	tunnel_name: Option<&str>,
) {
	let product = constants::QUALITYLESS_PRODUCT_NAME;
	let token_suffix = token.map(|t| format!("?tkn={t}")).unwrap_or_default();
	output::print_banner_header(&format!("{product} Agent Host"), started.elapsed());
	if let (Some(base), Some(name)) = (constants::EDITOR_WEB_URL, tunnel_name) {
		output::print_banner_line("Tunnel", &format!("{base}/agents/tunnel/{name}"));
	}
	let banner_listen_ip = host
		.and_then(|h| h.parse::<std::net::IpAddr>().ok())
		.unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
	output::print_network_lines(port, banner_listen_ip, &token_suffix);
	output::print_banner_line("Manage", "code agent ps  |  code agent kill");
	output::print_banner_footer();
	let _ = std::io::stdout().flush();
	log.result(format!(
		"Agent host supervisor already running (PID {pid}). \
		 Use `code agent kill` to stop it, or `code agent host --replace` to start a fresh one."
	));
}

fn detect_config_conflict(
	args: &AgentHostArgs,
	lockfile_host: Option<&str>,
	lockfile_port: u16,
	lockfile_token: Option<&str>,
	lockfile_tunnel: Option<&str>,
) -> Option<String> {
	if let (Some(requested), Some(running)) = (args.host.as_deref(), lockfile_host) {
		if requested != running {
			return Some(format!(
				"--host {requested} conflicts with the running supervisor (bound to {running})"
			));
		}
	}
	if args.port != 0 && args.port != lockfile_port {
		return Some(format!(
			"--port {requested} conflicts with the running supervisor (bound to {running})",
			requested = args.port,
			running = lockfile_port,
		));
	}
	if args.without_connection_token && lockfile_token.is_some() {
		return Some(
			"--without-connection-token conflicts with the running supervisor (uses a token)"
				.to_string(),
		);
	}
	if let Some(requested) = args.connection_token.as_deref() {
		match lockfile_token {
			None => {
				return Some(
					"--connection-token conflicts with the running supervisor (no token configured)"
						.to_string(),
				);
			}
			Some(running) if running != requested => {
				return Some(
					"--connection-token conflicts with the running supervisor's token".to_string(),
				);
			}
			Some(_) => {}
		}
	}
	if args.tunnel && lockfile_tunnel.is_none() {
		return Some(
			"--tunnel conflicts with the running supervisor (not exposed via a tunnel)".to_string(),
		);
	}
	None
}

async fn replace_existing(log: &log::Logger, lockfile: &Path, pid: u32) -> Result<(), AnyError> {
	if let Err(e) = kill_tree(pid).await {
		warning!(
			log,
			"Failed to kill existing agent host (PID {}): {}",
			pid,
			e
		);
	}
	let _ = remove_agent_host_metadata(lockfile);
	Ok(())
}

async fn daemonize_supervisor(args: &AgentHostArgs) -> Result<i32, AnyError> {
	let exe = std::env::current_exe().map_err(|e| wrap(e, "could not resolve current_exe"))?;
	let mut cmd = tokio::process::Command::new(&exe);
	cmd.args(std::env::args_os().skip(1));
	cmd.env(SUPERVISOR_ENV, "1");
	cmd.stdin(std::process::Stdio::null());
	cmd.stdout(std::process::Stdio::piped());
	cmd.stderr(std::process::Stdio::piped());
	cmd.kill_on_drop(false);
	cmd.detach_from_parent();

	let _ = args;

	let mut child = cmd
		.spawn()
		.map_err(|e| wrap(e, "could not spawn detached agent host supervisor"))?;
	let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
	let mut stderr = BufReader::new(child.stderr.take().unwrap()).lines();

	let timeout = tokio::time::sleep(SUPERVISOR_READY_TIMEOUT);
	tokio::pin!(timeout);

	loop {
		tokio::select! {
			r = stdout.next_line() => match r {
				Ok(Some(line)) => {
					if line == SUPERVISOR_READY_LINE {
						return Ok(0);
					}
					println!("{line}");
				}
				Ok(None) | Err(_) => {
					eprintln!("Agent host supervisor exited before becoming ready.");
					return Ok(1);
				}
			},
			r = stderr.next_line() => {
				if let Ok(Some(line)) = r {
					eprintln!("{line}");
				}
			},
			_ = &mut timeout => {
				eprintln!(
					"Timed out after {}s waiting for agent host supervisor to become ready.",
					SUPERVISOR_READY_TIMEOUT.as_secs()
				);
				return Ok(1);
			}
		}
	}
}

pub async fn ensure_supervisor_running(
	launcher_paths: &LauncherPaths,
	log: &log::Logger,
) -> Result<ActiveAgentHost, AnyError> {
	let lockfile_path = launcher_paths.agent_host_lockfile();
	if let AgentHostLockfileDecision::Reuse {
		pid,
		host,
		port,
		token,
		..
	} = classify_agent_host_lockfile(log, &lockfile_path)
	{
		return Ok(ActiveAgentHost {
			pid,
			host,
			port,
			token,
		});
	}

	info!(
		log,
		"No agent host supervisor running; starting one in the background"
	);

	let exe = std::env::current_exe().map_err(|e| wrap(e, "could not resolve current_exe"))?;
	let mut cmd = tokio::process::Command::new(&exe);
	cmd.arg("--cli-data-dir").arg(launcher_paths.root());
	cmd.arg("agent").arg("host");
	cmd.env(SUPERVISOR_ENV, "1");
	cmd.stdin(std::process::Stdio::null());
	cmd.stdout(std::process::Stdio::piped());
	cmd.stderr(std::process::Stdio::piped());
	cmd.kill_on_drop(false);
	cmd.detach_from_parent();

	let mut child = cmd
		.spawn()
		.map_err(|e| wrap(e, "could not spawn agent host supervisor"))?;
	let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
	let mut stderr = BufReader::new(child.stderr.take().unwrap()).lines();

	let timeout = tokio::time::sleep(SUPERVISOR_READY_TIMEOUT);
	tokio::pin!(timeout);

	loop {
		tokio::select! {
			r = stdout.next_line() => match r {
				Ok(Some(line)) => {
					if line == SUPERVISOR_READY_LINE {
						break;
					}
				}
				Ok(None) | Err(_) => {
					return Err(CodeError::CouldNotListenOnInterface(std::io::Error::other(
						"agent host supervisor exited before becoming ready",
					))
					.into());
				}
			},
			r = stderr.next_line() => {
				if let Ok(Some(line)) = r {
					debug!(log, "[supervisor stderr]: {}", line);
				}
			},
			_ = &mut timeout => {
				return Err(CodeError::CouldNotListenOnInterface(std::io::Error::other(format!(
					"timed out after {}s waiting for agent host supervisor",
					SUPERVISOR_READY_TIMEOUT.as_secs()
				)))
				.into());
			}
		}
	}

	match classify_agent_host_lockfile(log, &lockfile_path) {
		AgentHostLockfileDecision::Reuse {
			pid,
			host,
			port,
			token,
			..
		} => Ok(ActiveAgentHost {
			pid,
			host,
			port,
			token,
		}),
		AgentHostLockfileDecision::SpawnFresh => Err(CodeError::CouldNotListenOnInterface(
			std::io::Error::other("agent host supervisor signalled ready but lockfile is missing"),
		)
		.into()),
	}
}

pub struct ActiveAgentHost {
	pub pid: u32,
	pub host: Option<String>,
	pub port: u16,
	pub token: Option<String>,
}

impl ActiveAgentHost {
	pub fn dial_host(&self) -> &str {
		dial_host(self.host.as_deref())
	}

	pub fn apply_to_bridge(&self, csa: &mut CodeServerArgs) {
		csa.agent_host_bridge_host = Some(self.dial_host().to_string());
		csa.agent_host_bridge_port = Some(self.port);
		csa.agent_host_bridge_connection_token = self.token.clone();
	}
}

pub fn dial_host(bound: Option<&str>) -> &str {
	match bound {
		Some("0.0.0.0") | Some("::") | Some("[::]") | None => "127.0.0.1",
		Some(other) => other,
	}
}

fn redirect_stdio_to_null() -> std::io::Result<()> {
	let null_path = if cfg!(windows) { "NUL" } else { "/dev/null" };
	let null = std::fs::OpenOptions::new()
		.read(true)
		.write(true)
		.open(null_path)?;

	#[cfg(unix)]
	{
		use std::os::unix::io::AsRawFd as _;
		let fd = null.as_raw_fd();
		unsafe {
			if libc::dup2(fd, 0) < 0 || libc::dup2(fd, 1) < 0 || libc::dup2(fd, 2) < 0 {
				return Err(std::io::Error::last_os_error());
			}
		}
	}
	#[cfg(windows)]
	{
		use std::os::windows::io::AsRawHandle as _;
		use windows_sys::Win32::System::Console::{
			SetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
		};
		let handle = null.as_raw_handle();
		unsafe {
			if SetStdHandle(STD_INPUT_HANDLE, handle as _) == 0
				|| SetStdHandle(STD_OUTPUT_HANDLE, handle as _) == 0
				|| SetStdHandle(STD_ERROR_HANDLE, handle as _) == 0
			{
				return Err(std::io::Error::last_os_error());
			}
		}
		std::mem::forget(null);
	}
	Ok(())
}

fn mint_connection_token(path: &Path, prefer_token: Option<String>) -> std::io::Result<String> {
	#[cfg(not(windows))]
	use std::os::unix::fs::OpenOptionsExt;

	let mut file_options = fs::OpenOptions::new();
	file_options.create(true);
	file_options.write(true);
	file_options.read(true);
	#[cfg(not(windows))]
	file_options.mode(0o600);
	let mut file = file_options.open(path)?;

	if prefer_token.is_none() {
		let mut token = String::new();
		file.read_to_string(&mut token)?;
		let token = token.trim();
		if !token.is_empty() {
			return Ok(token.to_string());
		}
	}

	file.set_len(0)?;
	let prefer_token = prefer_token.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
	file.write_all(prefer_token.as_bytes())?;
	Ok(prefer_token)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;

	#[test]
	fn mint_connection_token_generates_and_persists() {
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("token");

		let token1 = mint_connection_token(&path, None).unwrap();
		assert!(!token1.is_empty());
		assert_eq!(fs::read_to_string(&path).unwrap(), token1);

		let token2 = mint_connection_token(&path, None).unwrap();
		assert_eq!(token1, token2);
	}

	#[test]
	fn mint_connection_token_respects_preferred() {
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("token");

		let token = mint_connection_token(&path, Some("my-token".to_string())).unwrap();
		assert_eq!(token, "my-token");
		assert_eq!(fs::read_to_string(&path).unwrap(), "my-token");
	}

	#[test]
	fn mint_connection_token_preferred_overwrites_existing() {
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("token");

		mint_connection_token(&path, None).unwrap();

		let token = mint_connection_token(&path, Some("override".to_string())).unwrap();
		assert_eq!(token, "override");
		assert_eq!(fs::read_to_string(&path).unwrap(), "override");
	}
}
