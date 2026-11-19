/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


use serde::Serialize;

use crate::tunnels::agent_host_registry::AgentHostEndpointMetadata;
use crate::tunnels::user_data_path::resolve_user_data_path;
use crate::util::errors::{wrap, AnyError};

use super::agent_discovery;
use super::args::AgentEndpointsArgs;
use super::CommandContext;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct EndpointsDocument {
	user_data_path: String,
	endpoints: Vec<AgentHostEndpointMetadata>,
}

pub async fn agent_endpoints(
	mut ctx: CommandContext,
	args: AgentEndpointsArgs,
) -> Result<i32, AnyError> {
	ctx.log = crate::log::Logger::new(crate::log::Level::Off);
	let user_data_path = resolve_user_data_path(args.user_data_dir.as_deref());
	let endpoints = agent_discovery::discover_live_endpoints(&ctx, args.user_data_dir.as_deref());

	let doc = EndpointsDocument {
		user_data_path: user_data_path.display().to_string(),
		endpoints,
	};

	let json =
		serde_json::to_string(&doc).map_err(|e| wrap(e, "failed to serialize agent endpoints"))?;

	println!("{json}");

	Ok(0)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::log;
	use crate::tunnels::agent_host_registry::{self, AgentHostEndpointMetadata};

	#[test]
	fn endpoints_document_serializes_with_camel_case_and_full_metadata() {
		let entry = AgentHostEndpointMetadata::new_standalone(
			42,
			"instance-a".to_string(),
			"127.0.0.1".to_string(),
			8080,
			"super-secret-token".to_string(),
			"0.1.0".to_string(),
			None,
			None,
		);
		let doc = EndpointsDocument {
			user_data_path: "/tmp/user-data".to_string(),
			endpoints: vec![entry],
		};

		let json = serde_json::to_string(&doc).unwrap();
		assert!(
			json.contains(r#""userDataPath":"/tmp/user-data""#),
			"{json}"
		);
		assert!(json.contains(r#""instanceId":"instance-a""#), "{json}");
		assert!(
			json.contains(r#""connectionToken":"super-secret-token""#),
			"{json}"
		);
	}

	#[tokio::test]
	async fn agent_endpoints_uses_user_data_dir_override_to_find_registry() {
		let dir = tempfile::tempdir().unwrap();
		let user_data_path = dir.path().join("custom-user-data");

		let entry = AgentHostEndpointMetadata::new_standalone(
			std::process::id(),
			"instance-b".to_string(),
			"127.0.0.1".to_string(),
			1234,
			"tok".to_string(),
			"0.1.0".to_string(),
			None,
			None,
		);
		agent_host_registry::publish_agent_host_endpoint(
			&log::Logger::test(),
			&user_data_path,
			&entry,
		)
		.unwrap();

		let args = AgentEndpointsArgs {
			user_data_dir: Some(user_data_path.to_string_lossy().to_string()),
		};
		let resolved = resolve_user_data_path(args.user_data_dir.as_deref());
		assert_eq!(resolved, user_data_path);

		let endpoints = agent_host_registry::list_live_endpoints(&log::Logger::test(), &resolved);
		assert_eq!(endpoints.len(), 1);
		assert_eq!(endpoints[0].instance_id, "instance-b");
	}
}
