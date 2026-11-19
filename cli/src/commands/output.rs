/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


use std::io::Write;
use std::net::IpAddr;
use std::process::{Command, Stdio};
use std::time::Duration;

use console::{style, Style, Term};

use crate::constants;


pub struct Styles;

impl Styles {
	pub fn title() -> Style {
		Style::new().bold()
	}

	pub fn label() -> Style {
		Style::new().dim()
	}

	pub fn uri() -> Style {
		Style::new().cyan()
	}

	pub fn success() -> Style {
		Style::new().green().bold()
	}

	pub fn warning() -> Style {
		Style::new().yellow().bold()
	}

	pub fn error() -> Style {
		Style::new().red().bold()
	}

	pub fn muted() -> Style {
		Style::new().dim()
	}
}


pub fn print_paged(text: &str) {
	let term = Term::stdout();
	if !term.is_term() {
		print!("{text}");
		return;
	}

	let (term_height, _) = term.size();
	let term_height = term_height as usize;
	let line_count = text.lines().count();
	if line_count <= term_height.saturating_sub(1) {
		print!("{text}");
		return;
	}

	if let Ok(pager) = std::env::var("PAGER") {
		if !pager.is_empty() && try_external_pager(&pager, text) {
			return;
		}
	}

	#[cfg(not(windows))]
	if try_external_pager("less -R", text) {
		return;
	}

	builtin_pager(&term, text, term_height);
}

fn try_external_pager(pager: &str, text: &str) -> bool {
	let mut parts = pager.split_whitespace();
	let program = match parts.next() {
		Some(p) => p,
		None => return false,
	};
	let pager_args: Vec<&str> = parts.collect();

	match Command::new(program)
		.args(&pager_args)
		.stdin(Stdio::piped())
		.spawn()
	{
		Ok(mut child) => {
			if let Some(mut stdin) = child.stdin.take() {
				let _ = stdin.write_all(text.as_bytes());
			}
			let _ = child.wait();
			true
		}
		Err(_) => false,
	}
}

fn builtin_pager(term: &Term, text: &str, term_height: usize) {
	let lines: Vec<&str> = text.lines().collect();
	let total = lines.len();
	let page = term_height.saturating_sub(1);
	let mut offset: usize = 0;

	let _ = term.write_str("\x1b[?1049h");

	draw_page(term, &lines, offset, page);
	draw_status_bar(term, offset, total, page);

	loop {
		let key = read_pager_key(term);
		let new_offset = match key {
			PagerKey::Down => offset.saturating_add(1),
			PagerKey::Up => offset.saturating_sub(1),
			PagerKey::PageDown => offset.saturating_add(page),
			PagerKey::PageUp => offset.saturating_sub(page),
			PagerKey::Home => 0,
			PagerKey::End => total.saturating_sub(page),
			PagerKey::Quit => {
				break;
			}
			PagerKey::Other => offset,
		};

		let max_offset = total.saturating_sub(page);
		let new_offset = new_offset.min(max_offset);

		if new_offset != offset {
			offset = new_offset;
			let _ = term.clear_last_lines(page + 1);
			draw_page(term, &lines, offset, page);
			draw_status_bar(term, offset, total, page);
		}
	}

	let _ = term.write_str("\x1b[?1049l");
}

fn draw_page(term: &Term, lines: &[&str], offset: usize, page: usize) {
	let end = (offset + page).min(lines.len());
	for line in &lines[offset..end] {
		let _ = term.write_line(line);
	}
	for _ in (end - offset)..page {
		let _ = term.write_line("");
	}
}

fn draw_status_bar(term: &Term, offset: usize, total: usize, page: usize) {
	let end = (offset + page).min(total);
	let pct = (end * 100).checked_div(total).unwrap_or(100);
	let bar = format!(
		" lines {}-{} of {} ({pct}%)  ↑↓ scroll  PgUp/PgDn page  q quit ",
		offset + 1,
		end,
		total,
	);
	let _ = term.write_str(&format!("{}", Style::new().reverse().apply_to(bar)));
}


enum PagerKey {
	Up,
	Down,
	PageUp,
	PageDown,
	Home,
	End,
	Quit,
	Other,
}

#[cfg(not(windows))]
fn read_pager_key(term: &Term) -> PagerKey {
	use console::Key;
	match term.read_key() {
		Ok(Key::ArrowDown) | Ok(Key::Char('j')) | Ok(Key::Enter) => PagerKey::Down,
		Ok(Key::ArrowUp) | Ok(Key::Char('k')) => PagerKey::Up,
		Ok(Key::PageDown) | Ok(Key::Char(' ')) | Ok(Key::Char('f')) => PagerKey::PageDown,
		Ok(Key::PageUp) | Ok(Key::Char('b')) => PagerKey::PageUp,
		Ok(Key::Home) | Ok(Key::Char('g')) => PagerKey::Home,
		Ok(Key::End) | Ok(Key::Char('G')) => PagerKey::End,
		Ok(Key::Escape) | Ok(Key::Char('q')) | Ok(Key::Char('Q')) | Ok(Key::CtrlC) => {
			PagerKey::Quit
		}
		_ => PagerKey::Other,
	}
}

#[cfg(windows)]
fn read_pager_key(_term: &Term) -> PagerKey {
	use windows_sys::Win32::System::Console::{
		GetStdHandle, ReadConsoleInputW, INPUT_RECORD, KEY_EVENT, STD_INPUT_HANDLE,
	};
	use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
		VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_NEXT, VK_PRIOR, VK_RETURN, VK_UP,
	};

	loop {
		let mut record: INPUT_RECORD = unsafe { std::mem::zeroed() };
		let mut count: u32 = 0;

		let ok = unsafe {
			ReadConsoleInputW(GetStdHandle(STD_INPUT_HANDLE), &mut record, 1, &mut count)
		};
		if ok == 0 || count == 0 {
			return PagerKey::Other;
		}

		if record.EventType as u32 != KEY_EVENT {
			continue;
		}
		let key_event = unsafe { record.Event.KeyEvent };
		if key_event.bKeyDown == 0 {
			continue;
		}

		let vk = key_event.wVirtualKeyCode;
		let ch = unsafe { key_event.uChar.UnicodeChar };

		return match vk {
			VK_UP => PagerKey::Up,
			VK_DOWN => PagerKey::Down,
			VK_PRIOR => PagerKey::PageUp,
			VK_NEXT => PagerKey::PageDown,
			VK_HOME => PagerKey::Home,
			VK_END => PagerKey::End,
			VK_ESCAPE => PagerKey::Quit,
			VK_RETURN => PagerKey::Down,
			_ => {
				if let Some(c) = char::from_u32(ch as u32) {
					match c {
						'j' => PagerKey::Down,
						'k' => PagerKey::Up,
						' ' | 'f' => PagerKey::PageDown,
						'b' => PagerKey::PageUp,
						'g' => PagerKey::Home,
						'G' => PagerKey::End,
						'q' | 'Q' => PagerKey::Quit,
						'\x03' => PagerKey::Quit,
						_ => PagerKey::Other,
					}
				} else {
					PagerKey::Other
				}
			}
		};
	}
}


pub fn print_banner_header(title: &str, elapsed: Duration) {
	console::set_colors_enabled(true);
	console::set_colors_enabled_stderr(true);

	let version = constants::VSCODE_CLI_VERSION.unwrap_or("dev");
	let elapsed_ms = elapsed.as_millis();

	println!();
	println!(
		"  {} {}  {}",
		style(title).cyan().bold(),
		style(format!("v{version}")).dim(),
		style(format!("ready in {elapsed_ms}ms")).dim(),
	);
	println!();
}

const BANNER_LABEL_WIDTH: usize = 9;

pub fn print_banner_line(label: &str, value: &str) {
	println!(
		"  {}  {} {}",
		style("➜").green().bold(),
		style(format!(
			"{label}:{:>pad$}",
			"",
			pad = BANNER_LABEL_WIDTH.saturating_sub(label.len() + 1)
		))
		.bold(),
		style(value).cyan(),
	);
}

pub fn print_banner_line_dim(label: &str, hint: &str) {
	println!(
		"  {}  {} {}",
		style("➜").green().bold(),
		style(format!(
			"{label}:{:>pad$}",
			"",
			pad = BANNER_LABEL_WIDTH.saturating_sub(label.len() + 1)
		))
		.bold(),
		style(hint).dim(),
	);
}

pub fn print_banner_footer() {
	println!();
}

pub fn print_network_lines(port: u16, listen_ip: IpAddr, token_suffix: &str) {
	print_banner_line("Local", &format!("ws://localhost:{port}{token_suffix}"));

	if listen_ip.is_loopback() {
		print_banner_line_dim("Network", "use --host to expose");
	} else if listen_ip.is_unspecified() {
		if let Ok(ifas) = local_ip_address::list_afinet_netifas() {
			for (_, addr) in &ifas {
				if addr.is_loopback() || addr.is_ipv6() {
					continue;
				}
				print_banner_line("Network", &format!("ws://{addr}:{port}{token_suffix}"));
			}
		}
	} else {
		print_banner_line("Network", &format!("ws://{listen_ip}:{port}{token_suffix}"));
	}
}
