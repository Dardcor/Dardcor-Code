/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


use ahp::Client;
use ahp_types::commands::{ListSessionsParams, ListSessionsResult};
use ahp_types::ROOT_RESOURCE_URI;
use futures::stream::FuturesUnordered;
use futures::StreamExt;

use crate::log;
use crate::tunnels::agent_host_registry::{self, AgentHostEndpointMetadata};
use crate::tunnels::user_data_path::resolve_user_data_path;
use crate::util::errors::{AnyError, CodeError};

use super::agent;
use super::CommandContext;

pub fn discover_live_endpoints(
	ctx: &CommandContext,
	user_data_dir: Option<&str>,
) -> Vec<AgentHostEndpointMetadata> {
	let user_data_path = resolve_user_data_path(user_data_dir);
	trace!(
		ctx.log,
		"discovering live agent hosts in {}",
		user_data_path.display()
	);
	agent_host_registry::list_live_endpoints(&ctx.log, &user_data_path)
}

enum ProbeResult<T> {
	Found(T),
	NotFound,
	Unreachable(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SearchFailure {
	NotFound,
	Incomplete(Vec<String>),
}

async fn resolve_first_match<T, F>(mut probes: FuturesUnordered<F>) -> Result<T, SearchFailure>
where
	F: std::future::Future<Output = ProbeResult<T>>,
{
	let mut unreachable_labels = Vec::new();

	while let Some(probe) = probes.next().await {
		match probe {
			ProbeResult::Found(payload) => return Ok(payload),
			ProbeResult::NotFound => {}
			ProbeResult::Unreachable(label) => unreachable_labels.push(label),
		}
	}

	if unreachable_labels.is_empty() {
		Err(SearchFailure::NotFound)
	} else {
		Err(SearchFailure::Incomplete(unreachable_labels))
	}
}

async fn probe_host(
	ctx: &CommandContext,
	endpoint: AgentHostEndpointMetadata,
	session: &str,
) -> ProbeResult<Client> {
	let label = endpoint.label();

	let client = match agent::connect_to_endpoint(&endpoint).await {
		Ok(client) => client,
		Err(e) => {
			warning!(ctx.log, "Could not connect to agent host {}: {}", label, e);
			return ProbeResult::Unreachable(label);
		}
	};

	let listed: Result<ListSessionsResult, AnyError> = agent::request_with_auth(
		ctx,
		&client,
		"listSessions",
		ListSessionsParams {
			channel: ROOT_RESOURCE_URI.to_string(),
			limit: None,
			cursor: None,
		},
	)
	.await;

	match listed {
		Ok(r) if r.items.iter().any(|s| s.resource == session) => ProbeResult::Found(client),
		Ok(_) => {
			client.shutdown().await;
			ProbeResult::NotFound
		}
		Err(e) => {
			warning!(
				ctx.log,
				"Could not search agent host {} for session {}: {}",
				label,
				session,
				e
			);
			client.shutdown().await;
			ProbeResult::Unreachable(label)
		}
	}
}

pub async fn connect_to_session_host(
	ctx: &CommandContext,
	session: &str,
	user_data_dir: Option<&str>,
) -> Result<Client, AnyError> {
	let endpoints = discover_live_endpoints(ctx, user_data_dir);

	if endpoints.is_empty() {
		return Err(CodeError::NoRunningAgentHost.into());
	}

	let probes = FuturesUnordered::new();
	for endpoint in endpoints {
		probes.push(probe_host(ctx, endpoint, session));
	}

	match resolve_first_match(probes).await {
		Ok(client) => Ok(client),
		Err(SearchFailure::NotFound) => {
			Err(CodeError::SessionNotFoundOnAnyHost(session.to_string()).into())
		}
		Err(SearchFailure::Incomplete(unreachable_labels)) => Err(
			CodeError::IncompleteSessionSearch(session.to_string(), unreachable_labels.join(", "))
				.into(),
		),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	async fn fake_probe(
		delay: Option<std::time::Duration>,
		result: ProbeResult<u32>,
		completed: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
	) -> ProbeResult<u32> {
		if let Some(delay) = delay {
			tokio::time::sleep(delay).await;
		}
		if let Some(completed) = completed {
			completed.store(true, std::sync::atomic::Ordering::SeqCst);
		}
		result
	}

	#[tokio::test]
	async fn resolve_first_match_returns_immediately_and_cancels_remaining_probes() {
		use std::sync::atomic::{AtomicBool, Ordering};
		use std::sync::Arc;
		use std::time::Duration;

		let hung_probe_completed = Arc::new(AtomicBool::new(false));

		let probes = FuturesUnordered::new();
		probes.push(fake_probe(None, ProbeResult::Found(42), None));
		probes.push(fake_probe(
			Some(Duration::from_secs(3600)),
			ProbeResult::Unreachable("slow-host".to_string()),
			Some(hung_probe_completed.clone()),
		));

		let outcome = tokio::time::timeout(Duration::from_millis(200), resolve_first_match(probes))
			.await
			.expect("resolve_first_match must not wait on the hung probe")
			.expect("expected the fast host's match");

		assert_eq!(outcome, 42);
		assert!(
			!hung_probe_completed.load(Ordering::SeqCst),
			"the hung probe's future must be dropped/cancelled, not run to completion"
		);
	}

	#[tokio::test]
	async fn resolve_first_match_prefers_found_even_when_seen_after_unreachable() {
		use std::time::Duration;

		let probes = FuturesUnordered::new();
		probes.push(fake_probe(
			None,
			ProbeResult::Unreachable("host-a".to_string()),
			None,
		));
		probes.push(fake_probe(
			Some(Duration::from_millis(10)),
			ProbeResult::Found(7),
			None,
		));

		let outcome = resolve_first_match(probes)
			.await
			.expect("expected the delayed match to win");
		assert_eq!(outcome, 7);
	}

	#[tokio::test]
	async fn resolve_first_match_is_not_found_when_every_host_was_searched() {
		let probes = FuturesUnordered::new();
		probes.push(fake_probe(None, ProbeResult::NotFound, None));
		probes.push(fake_probe(None, ProbeResult::NotFound, None));

		let err = resolve_first_match::<u32, _>(probes)
			.await
			.expect_err("no host matched, so this should be an Err");
		assert_eq!(err, SearchFailure::NotFound);
	}

	#[tokio::test]
	async fn resolve_first_match_is_incomplete_when_a_host_could_not_be_searched() {
		let probes = FuturesUnordered::new();
		probes.push(fake_probe(None, ProbeResult::NotFound, None));
		probes.push(fake_probe(
			None,
			ProbeResult::Unreachable("host-b".to_string()),
			None,
		));

		let err = resolve_first_match::<u32, _>(probes)
			.await
			.expect_err("no host matched, so this should be an Err");
		assert_eq!(err, SearchFailure::Incomplete(vec!["host-b".to_string()]));
	}
}
