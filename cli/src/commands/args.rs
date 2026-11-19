/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::{fmt, path::PathBuf};

use crate::{constants, log, options, tunnels::code_server::CodeServerArgs};
use clap::{Args, Parser, Subcommand, ValueEnum};
use const_format::concatcp;

const CLI_NAME: &str = concatcp!(constants::PRODUCT_NAME_LONG, " CLI");
const HELP_COMMANDS: &str = concatcp!(
	"Usage: ",
	constants::APPLICATION_NAME,
	" [options][paths...]

To read output from another program, append '-' (e.g. 'echo Hello World | {name} -')"
);

const STANDALONE_TEMPLATE: &str = concatcp!(
	CLI_NAME,
	" Standalone - {version}

",
	HELP_COMMANDS,
	"
Running editor commands requires installing ",
	constants::QUALITYLESS_PRODUCT_NAME,
	", and may differ slightly.

{all-args}"
);
const INTEGRATED_TEMPLATE: &str = concatcp!(
	CLI_NAME,
	" - {version}

",
	HELP_COMMANDS,
	"

{all-args}"
);

const COMMIT_IN_VERSION: &str = match constants::VSCODE_CLI_COMMIT {
	Some(c) => c,
	None => "unknown",
};
const NUMBER_IN_VERSION: &str = match constants::VSCODE_CLI_VERSION {
	Some(c) => c,
	None => "dev",
};
const VERSION: &str = concatcp!(NUMBER_IN_VERSION, " (commit ", COMMIT_IN_VERSION, ")");

#[derive(Parser, Debug, Default)]
#[clap(
   help_template = INTEGRATED_TEMPLATE,
   long_about = None,
	 name = constants::APPLICATION_NAME,
   version = VERSION,
 )]
pub struct IntegratedCli {
	#[clap(flatten)]
	pub core: CliCore,
}

#[derive(Args, Debug, Default, Clone)]
pub struct CliCore {
	#[clap(name = "paths")]
	pub open_paths: Vec<String>,

	#[clap(flatten, next_help_heading = Some("EDITOR OPTIONS"))]
	pub editor_options: EditorOptions,

	#[clap(flatten, next_help_heading = Some("EDITOR TROUBLESHOOTING"))]
	pub troubleshooting: EditorTroubleshooting,

	#[clap(flatten, next_help_heading = Some("GLOBAL OPTIONS"))]
	pub global_options: GlobalOptions,

	#[clap(subcommand)]
	pub subcommand: Option<Commands>,
}

#[derive(Parser, Debug, Default)]
#[clap(
   help_template = STANDALONE_TEMPLATE,
   long_about = None,
   version = VERSION,
	 name = constants::APPLICATION_NAME,
 )]
pub struct StandaloneCli {
	#[clap(flatten)]
	pub core: CliCore,

	#[clap(subcommand)]
	pub subcommand: Option<StandaloneCommands>,
}

pub enum AnyCli {
	Integrated(IntegratedCli),
	Standalone(StandaloneCli),
}

impl AnyCli {
	pub fn core(&self) -> &CliCore {
		match self {
			AnyCli::Integrated(cli) => &cli.core,
			AnyCli::Standalone(cli) => &cli.core,
		}
	}
}

impl CliCore {
	pub fn get_base_code_args(&self) -> Vec<String> {
		let mut args = self.open_paths.clone();
		self.editor_options.add_code_args(&mut args);
		self.troubleshooting.add_code_args(&mut args);
		self.global_options.add_code_args(&mut args);
		args
	}
}

impl<'a> From<&'a CliCore> for CodeServerArgs {
	fn from(cli: &'a CliCore) -> Self {
		let mut args = CodeServerArgs {
			log: cli.global_options.log,
			accept_server_license_terms: true,
			..Default::default()
		};

		args.log = cli.global_options.log;
		args.accept_server_license_terms = true;

		if cli.global_options.verbose {
			args.verbose = true;
		}

		if cli.global_options.disable_telemetry {
			args.telemetry_level = Some(options::TelemetryLevel::Off);
		} else if cli.global_options.telemetry_level.is_some() {
			args.telemetry_level = cli.global_options.telemetry_level;
		}

		args
	}
}

#[derive(Subcommand, Debug, Clone)]
pub enum StandaloneCommands {
	Update(StandaloneUpdateArgs),
}

#[derive(Args, Debug, Clone)]
pub struct StandaloneUpdateArgs {
	#[clap(long)]
	pub check: bool,
}

#[derive(Subcommand, Debug, Clone)]

pub enum Commands {
	Tunnel(TunnelArgs),

	#[clap(name = "ext")]
	Extension(ExtensionArgs),

	Status,

	Version(VersionArgs),

	#[clap(about = concatcp!("Runs a local web version of ", constants::PRODUCT_NAME_LONG))]
	ServeWeb(ServeWebArgs),

	#[clap(hide = true)]
	CommandShell(CommandShellArgs),

	#[clap(name = "agent")]
	Agent(AgentArgs),
}

#[derive(Args, Debug, Clone)]
pub struct ServeWebArgs {
	#[clap(long)]
	pub host: Option<String>,
	#[clap(long)]
	pub socket_path: Option<String>,
	#[clap(long, default_value_t = 8000)]
	pub port: u16,
	#[clap(long)]
	pub connection_token: Option<String>,
	#[clap(long)]
	pub connection_token_file: Option<String>,
	#[clap(long)]
	pub without_connection_token: bool,
	#[clap(long)]
	pub accept_server_license_terms: bool,
	#[clap(long)]
	pub server_base_path: Option<String>,
	#[clap(long)]
	pub server_data_dir: Option<String>,
	#[clap(long)]
	pub default_folder: Option<String>,
	#[clap(long)]
	pub default_workspace: Option<String>,
	#[clap(long)]
	pub disable_telemetry: bool,
	#[clap(long)]
	pub commit_id: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct AgentHostArgs {
	#[clap(long)]
	pub host: Option<String>,
	#[clap(long, default_value_t = 0)]
	pub port: u16,
	#[clap(long)]
	pub connection_token: Option<String>,
	#[clap(long)]
	pub connection_token_file: Option<String>,
	#[clap(long)]
	pub without_connection_token: bool,
	#[clap(long)]
	pub server_data_dir: Option<String>,

	#[clap(long)]
	pub replace: bool,

	#[clap(long)]
	pub tunnel: bool,
	#[clap(long)]
	pub name: Option<String>,
	#[clap(long)]
	pub random_name: bool,

	#[clap(flatten, next_help_heading = Some("ADVANCED TUNNEL OPTIONS"))]
	pub existing_tunnel: ExistingTunnelArgs,
}

#[derive(Args, Debug, Clone)]
pub struct AgentArgs {
	#[clap(subcommand)]
	pub subcommand: Option<AgentSubcommand>,

	#[clap(flatten)]
	pub host_args: AgentHostArgs,
}

#[derive(Subcommand, Debug, Clone)]
pub enum AgentSubcommand {
	Host(AgentHostArgs),

	Ps(AgentPsArgs),

	Stop(AgentStopArgs),

	Kill,

	Logs(AgentLogsArgs),
}

#[derive(Args, Debug, Clone)]
pub struct AgentPsArgs {
	#[clap(long)]
	pub address: Option<String>,

	#[clap(long)]
	pub tunnel: Option<String>,

	#[clap(long)]
	pub json: bool,

	#[clap(long, short)]
	pub all: bool,
}

#[derive(Args, Debug, Clone)]
pub struct AgentStopArgs {
	pub session: String,

	#[clap(long)]
	pub address: Option<String>,

	#[clap(long)]
	pub tunnel: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct AgentLogsArgs {
	pub session: String,

	#[clap(long)]
	pub address: Option<String>,

	#[clap(long)]
	pub tunnel: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct CommandShellArgs {
	#[clap(flatten)]
	pub server_args: BaseServerArgs,

	#[clap(long)]
	pub on_socket: bool,
	#[clap(long, num_args = 0..=2, default_missing_value = "0")]
	pub on_port: Vec<u16>,
	#[clap[long]]
	pub on_host: Option<String>,
	#[clap(long, env = "VSCODE_CLI_REQUIRE_TOKEN")]
	pub require_token: Option<String>,
	#[clap(long, hide = true)]
	pub parent_process_id: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct ExtensionArgs {
	#[clap(subcommand)]
	pub subcommand: ExtensionSubcommand,

	#[clap(flatten)]
	pub desktop_code_options: DesktopCodeOptions,
}

impl ExtensionArgs {
	pub fn add_code_args(&self, target: &mut Vec<String>) {
		self.desktop_code_options.add_code_args(target);
		self.subcommand.add_code_args(target);
	}
}

#[derive(Subcommand, Debug, Clone)]
pub enum ExtensionSubcommand {
	List(ListExtensionArgs),
	Install(InstallExtensionArgs),
	Uninstall(UninstallExtensionArgs),
	Update,
}

impl ExtensionSubcommand {
	pub fn add_code_args(&self, target: &mut Vec<String>) {
		match self {
			ExtensionSubcommand::List(args) => {
				target.push("--list-extensions".to_string());
				if args.show_versions {
					target.push("--show-versions".to_string());
				}
				if let Some(category) = &args.category {
					target.push(format!("--category={category}"));
				}
			}
			ExtensionSubcommand::Install(args) => {
				for id in args.id_or_path.iter() {
					target.push(format!("--install-extension={id}"));
				}
				if args.pre_release {
					target.push("--pre-release".to_string());
				}
				if args.donot_include_pack_and_dependencies {
					target.push("do-not-include-pack-dependencies".to_string());
				}
				if args.force {
					target.push("--force".to_string());
				}
			}
			ExtensionSubcommand::Uninstall(args) => {
				for id in args.id.iter() {
					target.push(format!("--uninstall-extension={id}"));
				}
			}
			ExtensionSubcommand::Update => {
				target.push("--update-extensions".to_string());
			}
		}
	}
}

#[derive(Args, Debug, Clone)]
pub struct ListExtensionArgs {
	#[clap(long, value_name = "category")]
	pub category: Option<String>,

	#[clap(long)]
	pub show_versions: bool,
}

#[derive(Args, Debug, Clone)]
pub struct InstallExtensionArgs {
	#[clap(name = "ext-id | id")]
	pub id_or_path: Vec<String>,

	#[clap(long)]
	pub pre_release: bool,

	#[clap(long)]
	pub donot_include_pack_and_dependencies: bool,

	#[clap(long)]
	pub force: bool,
}

#[derive(Args, Debug, Clone)]
pub struct UninstallExtensionArgs {
	#[clap(name = "ext-id")]
	pub id: Vec<String>,
}

#[derive(Args, Debug, Clone)]
pub struct VersionArgs {
	#[clap(subcommand)]
	pub subcommand: VersionSubcommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum VersionSubcommand {
	Use(UseVersionArgs),

	Show,
}

#[derive(Args, Debug, Clone)]
pub struct UseVersionArgs {
	#[clap(value_name = "stable | insiders | x.y.z | path")]
	pub name: String,

	#[clap(long, value_name = "path")]
	pub install_dir: Option<String>,
}

#[derive(Args, Debug, Default, Clone)]
pub struct EditorOptions {
	#[clap(short, long, value_names = &["file", "file"])]
	pub diff: Vec<String>,

	#[clap(short, long, value_name = "folder")]
	pub add: Option<String>,

	#[clap(short, long, value_name = "file:line[:character]")]
	pub goto: Option<String>,

	#[clap(short, long)]
	pub new_window: bool,

	#[clap(short, long)]
	pub reuse_window: bool,

	#[clap(short, long)]
	pub wait: bool,

	#[clap(long, value_name = "locale")]
	pub locale: Option<String>,

	#[clap(long, value_name = "ext-id")]
	pub enable_proposed_api: Vec<String>,

	#[clap(flatten)]
	pub code_options: DesktopCodeOptions,
}

impl EditorOptions {
	pub fn add_code_args(&self, target: &mut Vec<String>) {
		if !self.diff.is_empty() {
			target.push("--diff".to_string());
			for file in self.diff.iter() {
				target.push(file.clone());
			}
		}
		if let Some(add) = &self.add {
			target.push("--add".to_string());
			target.push(add.clone());
		}
		if let Some(goto) = &self.goto {
			target.push("--goto".to_string());
			target.push(goto.clone());
		}
		if self.new_window {
			target.push("--new-window".to_string());
		}
		if self.reuse_window {
			target.push("--reuse-window".to_string());
		}
		if self.wait {
			target.push("--wait".to_string());
		}
		if let Some(locale) = &self.locale {
			target.push(format!("--locale={locale}"));
		}
		if !self.enable_proposed_api.is_empty() {
			for id in self.enable_proposed_api.iter() {
				target.push(format!("--enable-proposed-api={id}"));
			}
		}
		self.code_options.add_code_args(target);
	}
}

#[derive(Args, Debug, Default, Clone)]
pub struct DesktopCodeOptions {
	#[clap(long, value_name = "dir")]
	pub extensions_dir: Option<String>,

	#[clap(long, value_name = "dir")]
	pub user_data_dir: Option<String>,

	#[clap(long, value_name = "stable | insiders | x.y.z | path")]
	pub use_version: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct OutputFormatOptions {
	#[clap(value_enum, long, value_name = "format", default_value_t = OutputFormat::Text)]
	pub format: OutputFormat,
}

impl DesktopCodeOptions {
	pub fn add_code_args(&self, target: &mut Vec<String>) {
		if let Some(extensions_dir) = &self.extensions_dir {
			target.push(format!("--extensions-dir={extensions_dir}"));
		}
		if let Some(user_data_dir) = &self.user_data_dir {
			target.push(format!("--user-data-dir={user_data_dir}"));
		}
	}
}

#[derive(Args, Debug, Default, Clone)]
pub struct GlobalOptions {
	#[clap(long, env = "VSCODE_CLI_DATA_DIR", global = true)]
	pub cli_data_dir: Option<String>,

	#[clap(long, global = true)]
	pub verbose: bool,

	#[clap(long, global = true, hide = true)]
	pub log_to_file: Option<PathBuf>,

	#[clap(long, value_enum, value_name = "level", global = true)]
	pub log: Option<log::Level>,

	#[clap(long, global = true, hide = true)]
	pub disable_telemetry: bool,

	#[clap(value_enum, long, global = true, hide = true)]
	pub telemetry_level: Option<options::TelemetryLevel>,
}

impl GlobalOptions {
	pub fn add_code_args(&self, target: &mut Vec<String>) {
		if self.verbose {
			target.push("--verbose".to_string());
		}
		if let Some(log) = self.log {
			target.push(format!("--log={log}"));
		}
		if self.disable_telemetry {
			target.push("--disable-telemetry".to_string());
		}
		if let Some(telemetry_level) = &self.telemetry_level {
			target.push(format!("--telemetry-level={telemetry_level}"));
		}
	}
}

#[derive(Args, Debug, Default, Clone)]
pub struct EditorTroubleshooting {
	#[clap(long)]
	pub prof_startup: bool,

	#[clap(long)]
	pub disable_extensions: bool,

	#[clap(long, value_name = "ext-id")]
	pub disable_extension: Vec<String>,

	#[clap(value_enum, long, value_name = "on | off")]
	pub sync: Option<SyncState>,

	#[clap(long, value_name = "port")]
	pub inspect_extensions: Option<u16>,

	#[clap(long, value_name = "port")]
	pub inspect_brk_extensions: Option<u16>,

	#[clap(long)]
	pub disable_gpu: bool,

	#[clap(long)]
	pub telemetry: bool,
}

impl EditorTroubleshooting {
	pub fn add_code_args(&self, target: &mut Vec<String>) {
		if self.prof_startup {
			target.push("--prof-startup".to_string());
		}
		if self.disable_extensions {
			target.push("--disable-extensions".to_string());
		}
		for id in self.disable_extension.iter() {
			target.push(format!("--disable-extension={id}"));
		}
		if let Some(sync) = &self.sync {
			target.push(format!("--sync={sync}"));
		}
		if let Some(port) = &self.inspect_extensions {
			target.push(format!("--inspect-extensions={port}"));
		}
		if let Some(port) = &self.inspect_brk_extensions {
			target.push(format!("--inspect-brk-extensions={port}"));
		}
		if self.disable_gpu {
			target.push("--disable-gpu".to_string());
		}
		if self.telemetry {
			target.push("--telemetry".to_string());
		}
	}
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum SyncState {
	On,
	Off,
}

impl fmt::Display for SyncState {
	fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
		match self {
			SyncState::Off => write!(f, "off"),
			SyncState::On => write!(f, "on"),
		}
	}
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum OutputFormat {
	Json,
	Text,
}

#[derive(Args, Clone, Debug, Default)]
pub struct ExistingTunnelArgs {
	#[clap(long, hide = true)]
	pub tunnel_name: Option<String>,

	#[clap(long, hide = true)]
	pub host_token: Option<String>,

	#[clap(long, hide = true)]
	pub tunnel_id: Option<String>,

	#[clap(long, hide = true)]
	pub cluster: Option<String>,
}

#[derive(Args, Debug, Clone, Default)]
pub struct TunnelServeArgs {
	#[clap(flatten)]
	pub server_args: BaseServerArgs,

	#[clap(flatten, next_help_heading = Some("ADVANCED OPTIONS"))]
	pub tunnel: ExistingTunnelArgs,

	#[clap(long)]
	pub random_name: bool,

	#[clap(long)]
	pub no_sleep: bool,

	#[clap(long)]
	pub name: Option<String>,

	#[clap(long, hide = true)]
	pub parent_process_id: Option<String>,

	#[clap(long)]
	pub accept_server_license_terms: bool,
}

#[derive(Args, Debug, Clone, Default)]
pub struct BaseServerArgs {
	#[clap(long)]
	pub install_extension: Vec<String>,

	#[clap(long)]
	pub server_data_dir: Option<String>,

	#[clap(long)]
	pub extensions_dir: Option<String>,

	#[clap(long)]
	pub reconnection_grace_time: Option<u32>,
}

impl BaseServerArgs {
	pub fn apply_to(&self, csa: &mut CodeServerArgs) {
		csa.install_extensions
			.extend_from_slice(&self.install_extension);

		if let Some(d) = &self.server_data_dir {
			csa.server_data_dir = Some(d.clone());
		}

		if let Some(d) = &self.extensions_dir {
			csa.extensions_dir = Some(d.clone());
		}

		if let Some(t) = self.reconnection_grace_time {
			csa.reconnection_grace_time = Some(t);
		}
	}
}

#[derive(Args, Debug, Clone)]
pub struct TunnelArgs {
	#[clap(subcommand)]
	pub subcommand: Option<TunnelSubcommand>,

	#[clap(flatten)]
	pub serve_args: TunnelServeArgs,
}

#[derive(Subcommand, Debug, Clone)]
pub enum TunnelSubcommand {
	Prune,

	Kill,

	Restart,

	Status,

	Rename(TunnelRenameArgs),

	Unregister,

	#[clap(subcommand)]
	User(TunnelUserSubCommands),

	#[clap(subcommand)]
	Service(TunnelServiceSubCommands),

	#[clap(hide = true)]
	ForwardInternal(TunnelForwardArgs),
}

#[derive(Subcommand, Debug, Clone)]
pub enum TunnelServiceSubCommands {
	Install(TunnelServiceInstallArgs),

	Uninstall,

	Log,

	#[clap(hide = true)]
	InternalRun,
}

#[derive(Args, Debug, Clone)]
pub struct TunnelServiceInstallArgs {
	#[clap(long)]
	pub accept_server_license_terms: bool,

	#[clap(long)]
	pub name: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct TunnelRenameArgs {
	pub name: String,
}

#[derive(Args, Debug, Clone)]
pub struct TunnelForwardArgs {
	pub ports: Vec<u16>,

	#[clap(flatten)]
	pub login: LoginArgs,
}

#[derive(Subcommand, Debug, Clone)]
pub enum TunnelUserSubCommands {
	Login(LoginArgs),

	Logout,

	Show,
}

#[derive(Args, Debug, Clone)]
pub struct LoginArgs {
	#[clap(long, requires = "provider", env = "VSCODE_CLI_ACCESS_TOKEN")]
	pub access_token: Option<String>,

	#[clap(long, requires = "access_token", env = "VSCODE_CLI_REFRESH_TOKEN")]
	pub refresh_token: Option<String>,

	#[clap(value_enum, long)]
	pub provider: Option<AuthProvider>,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
pub enum AuthProvider {
	Microsoft,
	Github,
}
