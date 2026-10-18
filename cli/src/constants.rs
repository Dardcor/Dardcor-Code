/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use serde::Deserialize;
use std::{collections::HashMap, io::IsTerminal};

use const_format::concatcp;
use std::sync::LazyLock;

use crate::options::Quality;

pub const CONTROL_PORT: u16 = 31545;
pub const AGENT_HOST_PORT: u16 = 31546;

pub const PROTOCOL_VERSION: u32 = 5;

pub const PROTOCOL_VERSION_TAG_PREFIX: &str = "protocolv";
pub const PROTOCOL_VERSION_TAG: &str = concatcp!("protocolv", PROTOCOL_VERSION);

pub const VSCODE_CLI_VERSION: Option<&'static str> = option_env!("VSCODE_CLI_VERSION");
pub const VSCODE_CLI_AI_KEY: Option<&'static str> = option_env!("VSCODE_CLI_AI_KEY");
pub const VSCODE_CLI_AI_ENDPOINT: Option<&'static str> = option_env!("VSCODE_CLI_AI_ENDPOINT");
pub const VSCODE_CLI_QUALITY: Option<&'static str> = option_env!("VSCODE_CLI_QUALITY");
pub const DOCUMENTATION_URL: Option<&'static str> = option_env!("VSCODE_CLI_DOCUMENTATION_URL");
pub const VSCODE_CLI_COMMIT: Option<&'static str> = option_env!("VSCODE_CLI_COMMIT");
pub const VSCODE_CLI_UPDATE_ENDPOINT: Option<&'static str> = option_env!("VSCODE_CLI_UPDATE_URL");

pub const TUNNEL_SERVICE_LOCK_NAME: Option<&'static str> =
	option_env!("VSCODE_CLI_WIN32_TUNNEL_SERVICE_MUTEX");

pub const TUNNEL_CLI_LOCK_NAME: Option<&'static str> = option_env!("VSCODE_CLI_WIN32_TUNNEL_MUTEX");

pub const TUNNEL_SERVICE_USER_AGENT_ENV_VAR: &str = "TUNNEL_SERVICE_USER_AGENT";

pub const APPLICATION_NAME: &str = match option_env!("VSCODE_CLI_APPLICATION_NAME") {
	Some(n) => n,
	None => "code",
};

pub const PRODUCT_NAME_LONG: &str = match option_env!("VSCODE_CLI_NAME_LONG") {
	Some(n) => n,
	None => "Code - OSS",
};

pub const QUALITYLESS_PRODUCT_NAME: &str = match option_env!("VSCODE_CLI_QUALITYLESS_PRODUCT_NAME")
{
	Some(n) => n,
	None => "Code",
};

pub const QUALITYLESS_SERVER_NAME: &str = concatcp!(QUALITYLESS_PRODUCT_NAME, " Server");

pub const QUALITY: &str = match VSCODE_CLI_QUALITY {
	Some(q) => q,
	_ => "oss",
};

pub const EDITOR_WEB_URL: Option<&'static str> = option_env!("VSCODE_CLI_TUNNEL_EDITOR_WEB_URL");

pub const TUNNEL_ACTIVITY_NAME: &str = concatcp!(PRODUCT_NAME_LONG, " Tunnel");

pub const PRODUCT_DOWNLOAD_URL: Option<&'static str> = option_env!("VSCODE_CLI_DOWNLOAD_URL");

const NONINTERACTIVE_VAR: &str = "VSCODE_CLI_NONINTERACTIVE";

pub const DEFAULT_DATA_PARENT_DIR: &str = match option_env!("VSCODE_CLI_DATA_FOLDER_NAME") {
	Some(n) => n,
	None => ".vscode-oss",
};

pub const SERVER_DATA_PARENT_DIR: &str = match option_env!("VSCODE_CLI_SERVER_DATA_FOLDER_NAME") {
	Some(n) => n,
	None => ".vscode-server-oss",
};

pub fn get_default_user_agent() -> String {
	format!(
		"vscode-server-launcher/{}",
		VSCODE_CLI_VERSION.unwrap_or("dev")
	)
}

const NO_COLOR_ENV: &str = "NO_COLOR";

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerQualityInfo {
	pub server_application_name: String,
}

pub static TUNNEL_SERVICE_USER_AGENT: LazyLock<String> =
	LazyLock::new(|| match std::env::var(TUNNEL_SERVICE_USER_AGENT_ENV_VAR) {
		Ok(ua) if !ua.is_empty() => format!("{} {}", ua, get_default_user_agent()),
		_ => get_default_user_agent(),
	});

pub static SERVER_NAME_MAP: LazyLock<Option<HashMap<Quality, ServerQualityInfo>>> =
	LazyLock::new(|| {
		option_env!("VSCODE_CLI_TUNNEL_SERVER_QUALITIES")
			.and_then(|s| serde_json::from_str(s).unwrap())
	});

pub static IS_A_TTY: LazyLock<bool> = LazyLock::new(|| std::io::stdin().is_terminal());

pub static COLORS_ENABLED: LazyLock<bool> =
	LazyLock::new(|| *IS_A_TTY && std::env::var(NO_COLOR_ENV).is_err());

pub static IS_INTERACTIVE_CLI: LazyLock<bool> =
	LazyLock::new(|| *IS_A_TTY && std::env::var(NONINTERACTIVE_VAR).is_err());

pub static WIN32_APP_IDS: LazyLock<Option<Vec<String>>> = LazyLock::new(|| {
	option_env!("VSCODE_CLI_WIN32_APP_IDS").map(|s| s.split(',').map(|s| s.to_string()).collect())
});
