/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


use std::ffi::OsStr;
use std::io;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

use windows_sys::core::PWSTR;
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
use windows_sys::Win32::Security::Authorization::{
	ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
	SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
	GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, ACL, DACL_SECURITY_INFORMATION,
	PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub(super) fn apply_owner_only_acl(path: &Path) -> io::Result<()> {
	let sid = current_user_sid_string()?;
	let sddl = format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");

	let descriptor = SecurityDescriptor::from_sddl(&sddl)?;
	let dacl = descriptor.dacl()?;
	let path_wide = to_wide_null(path.as_os_str());

	let result = unsafe {
		SetNamedSecurityInfoW(
			path_wide.as_ptr(),
			SE_FILE_OBJECT,
			DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
			ptr::null_mut(),
			ptr::null_mut(),
			dacl,
			ptr::null(),
		)
	};
	if result != 0 {
		return Err(io::Error::from_raw_os_error(result as i32));
	}
	Ok(())
}

fn current_user_sid_string() -> io::Result<String> {
	let mut token: HANDLE = ptr::null_mut();
	if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
		return Err(io::Error::last_os_error());
	}
	let token = OwnedHandle(token);

	let mut needed: u32 = 0;
	unsafe { GetTokenInformation(token.0, TokenUser, ptr::null_mut(), 0, &mut needed) };
	if needed == 0 {
		return Err(io::Error::last_os_error());
	}

	let mut buffer = vec![0u8; needed as usize];
	let ok = unsafe {
		GetTokenInformation(
			token.0,
			TokenUser,
			buffer.as_mut_ptr() as *mut _,
			needed,
			&mut needed,
		)
	};
	if ok == 0 {
		return Err(io::Error::last_os_error());
	}

	let sid = unsafe { (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid };
	sid_to_string(sid)
}

fn sid_to_string(sid: PSID) -> io::Result<String> {
	let mut string_sid: PWSTR = ptr::null_mut();
	if unsafe { ConvertSidToStringSidW(sid, &mut string_sid) } == 0 {
		return Err(io::Error::last_os_error());
	}
	Ok(LocalWideString(string_sid).to_string_lossy())
}

fn to_wide_null(value: &OsStr) -> Vec<u16> {
	value.encode_wide().chain(once(0)).collect()
}

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
	fn drop(&mut self) {
		unsafe {
			CloseHandle(self.0);
		}
	}
}

struct LocalWideString(PWSTR);

impl LocalWideString {
	fn to_string_lossy(&self) -> String {
		let len = unsafe { (0..).take_while(|&i| *self.0.add(i) != 0).count() };
		let slice = unsafe { std::slice::from_raw_parts(self.0, len) };
		String::from_utf16_lossy(slice)
	}
}

impl Drop for LocalWideString {
	fn drop(&mut self) {
		if !self.0.is_null() {
			unsafe {
				LocalFree(self.0 as HLOCAL);
			}
		}
	}
}

pub(super) struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

impl SecurityDescriptor {
	fn from_sddl(sddl: &str) -> io::Result<Self> {
		let wide = to_wide_null(OsStr::new(sddl));
		let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
		let ok = unsafe {
			ConvertStringSecurityDescriptorToSecurityDescriptorW(
				wide.as_ptr(),
				SDDL_REVISION_1,
				&mut descriptor,
				ptr::null_mut(),
			)
		};
		if ok == 0 {
			return Err(io::Error::last_os_error());
		}
		Ok(Self(descriptor))
	}

	#[cfg(test)]
	pub(super) fn from_raw(descriptor: PSECURITY_DESCRIPTOR) -> Self {
		Self(descriptor)
	}

	#[cfg(test)]
	pub(super) fn raw(&self) -> PSECURITY_DESCRIPTOR {
		self.0
	}

	pub(super) fn dacl(&self) -> io::Result<*const ACL> {
		let mut present = 0;
		let mut dacl: *mut ACL = ptr::null_mut();
		let mut defaulted = 0;
		let ok =
			unsafe { GetSecurityDescriptorDacl(self.0, &mut present, &mut dacl, &mut defaulted) };
		if ok == 0 {
			return Err(io::Error::last_os_error());
		}
		if present == 0 {
			return Err(io::Error::other(
				"security descriptor unexpectedly has no DACL",
			));
		}
		Ok(dacl)
	}
}

impl Drop for SecurityDescriptor {
	fn drop(&mut self) {
		if !self.0.is_null() {
			unsafe {
				LocalFree(self.0 as HLOCAL);
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use windows_sys::Win32::Security::Authorization::GetNamedSecurityInfoW;
	use windows_sys::Win32::Security::{
		GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE, CONTAINER_INHERIT_ACE,
		OBJECT_INHERIT_ACE, SE_DACL_PROTECTED,
	};

	const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
	const FILE_ALL_ACCESS: u32 = 0x001F_01FF;

	fn read_dacl(path: &Path) -> (SecurityDescriptor, *const ACL) {
		let path_wide = to_wide_null(path.as_os_str());
		let mut dacl: *mut ACL = ptr::null_mut();
		let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
		let result = unsafe {
			GetNamedSecurityInfoW(
				path_wide.as_ptr(),
				SE_FILE_OBJECT,
				DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
				ptr::null_mut(),
				ptr::null_mut(),
				&mut dacl,
				ptr::null_mut(),
				&mut descriptor,
			)
		};
		assert_eq!(result, 0, "GetNamedSecurityInfoW failed: {result}");
		(SecurityDescriptor::from_raw(descriptor), dacl)
	}

	#[test]
	fn apply_owner_only_acl_grants_exactly_user_system_and_admins() {
		let dir = tempfile::tempdir().unwrap();
		apply_owner_only_acl(dir.path()).unwrap();

		let (descriptor, dacl) = read_dacl(dir.path());

		let mut control: u16 = 0;
		let mut revision: u32 = 0;
		let ok =
			unsafe { GetSecurityDescriptorControl(descriptor.raw(), &mut control, &mut revision) };
		assert_ne!(ok, 0, "GetSecurityDescriptorControl failed");
		assert_ne!(
			control & SE_DACL_PROTECTED,
			0,
			"DACL must be protected (no inheritance from the parent directory)"
		);

		let ace_count = unsafe { (*dacl).AceCount };
		assert_eq!(ace_count, 3, "expected exactly one ACE per granted SID");

		let mut granted_sids = Vec::new();
		for index in 0..ace_count as u32 {
			let mut ace_ptr: *mut core::ffi::c_void = ptr::null_mut();
			let ok = unsafe { GetAce(dacl, index, &mut ace_ptr) };
			assert_ne!(ok, 0, "GetAce failed for index {index}");

			let ace = unsafe { &*(ace_ptr as *const ACCESS_ALLOWED_ACE) };
			assert_eq!(ace.Header.AceType, ACCESS_ALLOWED_ACE_TYPE);
			let inherit_flags = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
			assert_eq!(
				ace.Header.AceFlags as u32 & inherit_flags,
				inherit_flags,
				"ACE must carry object + container inherit flags for index {index}"
			);
			assert_eq!(ace.Mask, FILE_ALL_ACCESS, "ACE must grant full control");

			let sid = &ace.SidStart as *const u32 as PSID;
			granted_sids.push(sid_to_string(sid).unwrap());
		}
		granted_sids.sort();

		let mut expected = vec![
			current_user_sid_string().unwrap(),
			"S-1-5-18".to_string(),
			"S-1-5-32-544".to_string(),
		];
		expected.sort();
		assert_eq!(granted_sids, expected);
	}
}
