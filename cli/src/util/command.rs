/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
use super::errors::CodeError;
use std::{
	borrow::Cow,
	ffi::OsStr,
	process::{Output, Stdio},
};
use tokio::process::Command;

pub async fn capture_command_and_check_status(
	command_str: impl AsRef<OsStr>,
	args: &[impl AsRef<OsStr>],
) -> Result<std::process::Output, CodeError> {
	let output = capture_command(&command_str, args).await?;

	check_output_status(output, || {
		format!(
			"{} {}",
			command_str.as_ref().to_string_lossy(),
			args.iter()
				.map(|a| a.as_ref().to_string_lossy())
				.collect::<Vec<Cow<'_, str>>>()
				.join(" ")
		)
	})
}

pub fn check_output_status(
	output: Output,
	cmd_str: impl FnOnce() -> String,
) -> Result<std::process::Output, CodeError> {
	if !output.status.success() {
		return Err(CodeError::CommandFailed {
			command: cmd_str(),
			code: output.status.code().unwrap_or(-1),
			output: String::from_utf8_lossy(if output.stderr.is_empty() {
				&output.stdout
			} else {
				&output.stderr
			})
			.into(),
		});
	}

	Ok(output)
}

pub async fn capture_command<A, I, S>(
	command_str: A,
	args: I,
) -> Result<std::process::Output, CodeError>
where
	A: AsRef<OsStr>,
	I: IntoIterator<Item = S>,
	S: AsRef<OsStr>,
{
	new_tokio_command(&command_str)
		.args(args)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.output()
		.await
		.map_err(|e| CodeError::CommandFailed {
			command: command_str.as_ref().to_string_lossy().to_string(),
			code: -1,
			output: e.to_string(),
		})
}

#[cfg(windows)]
pub fn new_tokio_command(exe: impl AsRef<OsStr>) -> Command {
	let mut p = tokio::process::Command::new(exe);
	p.creation_flags(winapi::um::winbase::CREATE_NO_WINDOW);
	p
}

#[cfg(not(windows))]
pub fn new_tokio_command(exe: impl AsRef<OsStr>) -> Command {
	tokio::process::Command::new(exe)
}

#[cfg(windows)]
pub fn new_script_command(script: impl AsRef<OsStr>) -> Command {
	let mut cmd = new_tokio_command("cmd");
	cmd.arg("/Q");
	cmd.arg("/C");
	cmd.arg(script);
	cmd
}

#[cfg(not(windows))]
pub fn new_script_command(script: impl AsRef<OsStr>) -> Command {
	new_tokio_command(script)
}

#[cfg(windows)]
pub fn new_std_command(exe: impl AsRef<OsStr>) -> std::process::Command {
	let mut p = std::process::Command::new(exe);
	std::os::windows::process::CommandExt::creation_flags(
		&mut p,
		winapi::um::winbase::CREATE_NO_WINDOW,
	);
	p
}

#[cfg(not(windows))]
pub fn new_std_command(exe: impl AsRef<OsStr>) -> std::process::Command {
	std::process::Command::new(exe)
}

pub trait DetachFromParent {
	fn detach_from_parent(&mut self) -> &mut Self;
}

impl DetachFromParent for std::process::Command {
	fn detach_from_parent(&mut self) -> &mut Self {
		apply_detach_flags_std(self);
		self
	}
}

impl DetachFromParent for tokio::process::Command {
	fn detach_from_parent(&mut self) -> &mut Self {
		apply_detach_flags_tokio(self);
		self
	}
}

#[cfg(unix)]
fn apply_detach_flags_std(cmd: &mut std::process::Command) {
	use std::os::unix::process::CommandExt as _;
	unsafe {
		cmd.pre_exec(|| {
			if libc::setsid() == -1 {
				return Err(std::io::Error::last_os_error());
			}
			Ok(())
		});
	}
}

#[cfg(windows)]
fn apply_detach_flags_std(cmd: &mut std::process::Command) {
	use std::os::windows::process::CommandExt as _;
	cmd.creation_flags(
		winapi::um::winbase::CREATE_NEW_PROCESS_GROUP | winapi::um::winbase::CREATE_NO_WINDOW,
	);
}

#[cfg(unix)]
fn apply_detach_flags_tokio(cmd: &mut tokio::process::Command) {
	unsafe {
		cmd.pre_exec(|| {
			if libc::setsid() == -1 {
				return Err(std::io::Error::last_os_error());
			}
			Ok(())
		});
	}
}

#[cfg(windows)]
fn apply_detach_flags_tokio(cmd: &mut tokio::process::Command) {
	cmd.creation_flags(
		winapi::um::winbase::CREATE_NEW_PROCESS_GROUP | winapi::um::winbase::CREATE_NO_WINDOW,
	);
}

#[cfg(windows)]
pub async fn kill_tree(process_id: u32) -> Result<(), CodeError> {
	capture_command("taskkill", &["/t", "/pid", &process_id.to_string()]).await?;
	Ok(())
}

#[cfg(not(windows))]
pub async fn kill_tree(process_id: u32) -> Result<(), CodeError> {
	use futures::future::join_all;
	use std::collections::VecDeque;
	use tokio::io::{AsyncBufReadExt, BufReader};

	async fn kill_single_pid(process_id_str: String) {
		capture_command("kill", &[&process_id_str]).await.ok();
	}

	async fn children_of(parent: u32) -> Result<Vec<u32>, CodeError> {
		let parent_str = parent.to_string();
		let mut child = Command::new("pgrep")
			.arg("-P")
			.arg(&parent_str)
			.stdin(Stdio::null())
			.stdout(Stdio::piped())
			.stderr(Stdio::null())
			.spawn()
			.map_err(|e| CodeError::CommandFailed {
				command: format!("pgrep -P {parent_str}"),
				code: -1,
				output: e.to_string(),
			})?;

		let mut out = Vec::new();
		if let Some(stdout) = child.stdout.take() {
			let mut reader = BufReader::new(stdout).lines();
			while let Some(line) = reader.next_line().await.unwrap_or(None) {
				if let Ok(pid) = line.trim().parse::<u32>() {
					out.push(pid);
				}
			}
		}
		let status = child.wait().await.map_err(|e| CodeError::CommandFailed {
			command: format!("pgrep -P {parent_str}"),
			code: -1,
			output: e.to_string(),
		})?;
		match status.code() {
			Some(0) | Some(1) | None => Ok(out),
			Some(code) => Err(CodeError::CommandFailed {
				command: format!("pgrep -P {parent_str}"),
				code,
				output: String::new(),
			}),
		}
	}


	let mut all_pids: Vec<u32> = vec![process_id];
	let mut queue: VecDeque<u32> = VecDeque::from([process_id]);
	let mut first = true;
	while let Some(pid) = queue.pop_front() {
		let children = match children_of(pid).await {
			Ok(c) => c,
			Err(e) if first => return Err(e),
			Err(_) => Vec::new(),
		};
		first = false;
		for child in children {
			all_pids.push(child);
			queue.push_back(child);
		}
	}

	let kill_futures: Vec<_> = all_pids
		.into_iter()
		.map(|pid| tokio::spawn(kill_single_pid(pid.to_string())))
		.collect();
	join_all(kill_futures).await;
	Ok(())
}

#[cfg(all(test, not(windows)))]
mod tests {
	use super::*;
	use crate::util::machine::process_exists;
	use std::time::{Duration, Instant};
	use tokio::io::AsyncBufReadExt;

	#[tokio::test]
	async fn kill_tree_terminates_full_descendant_tree() {
		let script = "\
			sh -c 'sleep 30 & sleep_pid=$!; echo $$; echo $sleep_pid; echo ready; wait $sleep_pid' & \
			inner_pid=$!; \
			wait $inner_pid";
		let mut child = tokio::process::Command::new("sh")
			.arg("-c")
			.arg(script)
			.stdin(Stdio::null())
			.stdout(Stdio::piped())
			.stderr(Stdio::null())
			.spawn()
			.expect("spawn outer sh");

		let root_pid = child.id().expect("root sh has pid");

		let stdout = child.stdout.take().expect("stdout");
		let mut reader = tokio::io::BufReader::new(stdout).lines();
		let inner_pid: u32 = reader
			.next_line()
			.await
			.expect("read inner pid")
			.expect("inner pid line")
			.trim()
			.parse()
			.expect("inner pid integer");
		let sleep_pid: u32 = reader
			.next_line()
			.await
			.expect("read sleep pid")
			.expect("sleep pid line")
			.trim()
			.parse()
			.expect("sleep pid integer");
		assert_eq!(
			reader.next_line().await.expect("read ready").as_deref(),
			Some("ready")
		);

		let all_pids = [root_pid, inner_pid, sleep_pid];
		for pid in &all_pids {
			assert!(process_exists(*pid), "expected pid {pid} alive before kill");
		}

		kill_tree(root_pid).await.expect("kill_tree succeeds");

		let _ = child.wait().await;

		let deadline = Instant::now() + Duration::from_secs(10);
		loop {
			let alive: Vec<u32> = all_pids.iter().copied().filter(|p| process_exists(*p)).collect();
			if alive.is_empty() {
				break;
			}
			if Instant::now() >= deadline {
				panic!("pids still alive after kill_tree: {alive:?}");
			}
			tokio::time::sleep(Duration::from_millis(50)).await;
		}
	}
}
