/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


use std::path::PathBuf;

use crate::constants::PRODUCT_NAME_SHORT;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserDataOs {
	Windows,
	MacOs,
	Linux,
}

impl UserDataOs {
	pub fn current() -> Self {
		if cfg!(target_os = "windows") {
			UserDataOs::Windows
		} else if cfg!(target_os = "macos") {
			UserDataOs::MacOs
		} else {
			UserDataOs::Linux
		}
	}
}

#[derive(Debug, Clone, Default)]
pub struct UserDataPathEnv {
	pub vscode_portable: Option<String>,
	pub vscode_appdata: Option<String>,
	pub appdata: Option<String>,
	pub userprofile: Option<String>,
	pub xdg_config_home: Option<String>,
	pub home_dir: Option<PathBuf>,
}

impl UserDataPathEnv {
	pub fn from_process() -> Self {
		Self {
			vscode_portable: non_empty_env("VSCODE_PORTABLE"),
			vscode_appdata: non_empty_env("VSCODE_APPDATA"),
			appdata: non_empty_env("APPDATA"),
			userprofile: non_empty_env("USERPROFILE"),
			xdg_config_home: non_empty_env("XDG_CONFIG_HOME"),
			home_dir: dirs::home_dir(),
		}
	}
}

fn non_empty_env(name: &str) -> Option<String> {
	match std::env::var(name) {
		Ok(v) if !v.is_empty() => Some(v),
		_ => None,
	}
}

pub fn resolve_user_data_path(explicit: Option<&str>) -> PathBuf {
	resolve_user_data_path_with(
		explicit,
		PRODUCT_NAME_SHORT,
		UserDataOs::current(),
		&UserDataPathEnv::from_process(),
	)
}

pub fn resolve_user_data_path_with(
	explicit: Option<&str>,
	product_name: &str,
	os: UserDataOs,
	env: &UserDataPathEnv,
) -> PathBuf {
	if let Some(explicit) = explicit {
		return resolve_relative_to_cwd(explicit, os);
	}

	if let Some(portable) = &env.vscode_portable {
		return join_component(resolve_relative_to_cwd(portable, os), "user-data", os);
	}

	if let Some(appdata) = &env.vscode_appdata {
		return join_component(resolve_relative_to_cwd(appdata, os), product_name, os);
	}

	default_user_data_path_with(product_name, os, env)
}

pub fn default_user_data_path() -> PathBuf {
	default_user_data_path_with(
		PRODUCT_NAME_SHORT,
		UserDataOs::current(),
		&UserDataPathEnv::from_process(),
	)
}

pub fn default_user_data_path_with(
	product_name: &str,
	os: UserDataOs,
	env: &UserDataPathEnv,
) -> PathBuf {
	match os {
		UserDataOs::Windows => {
			let base = if let Some(appdata) = &env.appdata {
				PathBuf::from(appdata)
			} else if let Some(userprofile) = &env.userprofile {
				let base = join_component(PathBuf::from(userprofile), "AppData", os);
				join_component(base, "Roaming", os)
			} else {
				home_dir_or_empty(env)
			};
			join_component(base, product_name, os)
		}
		UserDataOs::MacOs => {
			let base = join_component(home_dir_or_empty(env), "Library", os);
			let base = join_component(base, "Application Support", os);
			join_component(base, product_name, os)
		}
		UserDataOs::Linux => {
			let base = if let Some(xdg) = &env.xdg_config_home {
				PathBuf::from(xdg)
			} else {
				join_component(home_dir_or_empty(env), ".config", os)
			};
			join_component(base, product_name, os)
		}
	}
}

fn home_dir_or_empty(env: &UserDataPathEnv) -> PathBuf {
	env.home_dir.clone().unwrap_or_else(|| PathBuf::from(""))
}

fn is_absolute_for_os(path: &str, os: UserDataOs) -> bool {
	match os {
		UserDataOs::Windows => {
			let bytes = path.as_bytes();
			let has_drive_root = bytes.len() >= 3
				&& bytes[0].is_ascii_alphabetic()
				&& bytes[1] == b':'
				&& (bytes[2] == b'\\' || bytes[2] == b'/');
			has_drive_root || path.starts_with("\\\\") || path.starts_with("//")
		}
		UserDataOs::MacOs | UserDataOs::Linux => path.starts_with('/'),
	}
}

fn join_component(base: PathBuf, component: &str, os: UserDataOs) -> PathBuf {
	let sep = match os {
		UserDataOs::Windows => '\\',
		UserDataOs::MacOs | UserDataOs::Linux => '/',
	};
	let mut s = base.to_string_lossy().into_owned();
	if !s.ends_with(['/', '\\']) {
		s.push(sep);
	}
	s.push_str(component);
	PathBuf::from(s)
}

fn resolve_relative_to_cwd(path: &str, os: UserDataOs) -> PathBuf {
	if is_absolute_for_os(path, os) {
		return PathBuf::from(path);
	}

	match std::env::current_dir() {
		Ok(cwd) => cwd.join(path),
		Err(_) => PathBuf::from(path),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn env_with_home(home: &str) -> UserDataPathEnv {
		UserDataPathEnv {
			home_dir: Some(PathBuf::from(home)),
			..Default::default()
		}
	}

	#[test]
	fn default_windows_path_uses_appdata() {
		let mut env = env_with_home(r"C:\Users\test");
		env.appdata = Some(r"C:\Users\test\AppData\Roaming".to_string());
		let path = default_user_data_path_with("Code - OSS", UserDataOs::Windows, &env);
		assert_eq!(
			path.to_string_lossy(),
			r"C:\Users\test\AppData\Roaming\Code - OSS"
		);
	}

	#[test]
	fn default_windows_path_falls_back_to_userprofile() {
		let mut env = env_with_home(r"C:\Users\test");
		env.userprofile = Some(r"C:\Users\test".to_string());
		let path = default_user_data_path_with("Code - OSS", UserDataOs::Windows, &env);
		assert_eq!(
			path.to_string_lossy(),
			r"C:\Users\test\AppData\Roaming\Code - OSS"
		);
	}

	#[test]
	fn default_macos_path_uses_application_support() {
		let env = env_with_home("/Users/test");
		let path = default_user_data_path_with("Code - OSS", UserDataOs::MacOs, &env);
		assert_eq!(
			path.to_string_lossy(),
			"/Users/test/Library/Application Support/Code - OSS"
		);
	}

	#[test]
	fn default_linux_path_uses_xdg_config_home() {
		let mut env = env_with_home("/home/test");
		env.xdg_config_home = Some("/home/test/.config".to_string());
		let path = default_user_data_path_with("Code - OSS", UserDataOs::Linux, &env);
		assert_eq!(path.to_string_lossy(), "/home/test/.config/Code - OSS");
	}

	#[test]
	fn default_linux_path_falls_back_to_home_dot_config() {
		let env = env_with_home("/home/test");
		let path = default_user_data_path_with("Code - OSS", UserDataOs::Linux, &env);
		assert_eq!(path.to_string_lossy(), "/home/test/.config/Code - OSS");
	}

	#[test]
	fn vscode_portable_overrides_default() {
		let mut env = env_with_home("/home/test");
		env.vscode_portable = Some("/mnt/portable".to_string());
		let path = resolve_user_data_path_with(None, "Code - OSS", UserDataOs::Linux, &env);
		assert_eq!(path, PathBuf::from("/mnt/portable/user-data"));
	}

	#[test]
	fn vscode_appdata_overrides_default() {
		let mut env = env_with_home("/home/test");
		env.vscode_appdata = Some("/mnt/appdata".to_string());
		let path = resolve_user_data_path_with(None, "Code - OSS", UserDataOs::Linux, &env);
		assert_eq!(path, PathBuf::from("/mnt/appdata/Code - OSS"));
	}

	#[test]
	fn explicit_dir_takes_precedence_over_portable_and_appdata() {
		let mut env = env_with_home("/home/test");
		env.vscode_portable = Some("/mnt/portable".to_string());
		env.vscode_appdata = Some("/mnt/appdata".to_string());
		let path = resolve_user_data_path_with(
			Some("/explicit/dir"),
			"Code - OSS",
			UserDataOs::Linux,
			&env,
		);
		assert_eq!(path, PathBuf::from("/explicit/dir"));
	}

	#[test]
	fn relative_explicit_dir_resolves_against_cwd() {
		let env = env_with_home("/home/test");
		let path = resolve_user_data_path_with(
			Some("relative-dir"),
			"Code - OSS",
			UserDataOs::Linux,
			&env,
		);
		assert_eq!(path, std::env::current_dir().unwrap().join("relative-dir"));
	}

	#[test]
	fn falls_back_to_platform_default_when_nothing_set() {
		let env = env_with_home("/home/test");
		let path = resolve_user_data_path_with(None, "Code - OSS", UserDataOs::Linux, &env);
		assert_eq!(path, PathBuf::from("/home/test/.config/Code - OSS"));
	}
}
