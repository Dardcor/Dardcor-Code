/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityEvent {
	Connected,
	Disconnected,
}

#[derive(Clone)]
pub struct ActivityTracker {
	tx: mpsc::UnboundedSender<ActivityEvent>,
}

impl ActivityTracker {
	pub fn client_connected(&self) -> ClientGuard {
		let _ = self.tx.send(ActivityEvent::Connected);
		ClientGuard {
			tx: self.tx.clone(),
		}
	}
}

pub struct ClientGuard {
	tx: mpsc::UnboundedSender<ActivityEvent>,
}

impl Drop for ClientGuard {
	fn drop(&mut self) {
		let _ = self.tx.send(ActivityEvent::Disconnected);
	}
}

pub fn new_activity_channel() -> (ActivityTracker, mpsc::UnboundedReceiver<ActivityEvent>) {
	let (tx, rx) = mpsc::unbounded_channel();
	(ActivityTracker { tx }, rx)
}

pub trait IdleSleeper: Send + Sync {
	fn sleep(&self, duration: Duration) -> Pin<Box<dyn Future<Output = ()> + Send>>;
}

pub struct TokioIdleSleeper;

impl IdleSleeper for TokioIdleSleeper {
	fn sleep(&self, duration: Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> {
		Box::pin(tokio::time::sleep(duration))
	}
}

pub async fn wait_for_idle_timeout(
	idle_timeout: Duration,
	mut events: mpsc::UnboundedReceiver<ActivityEvent>,
	sleeper: &dyn IdleSleeper,
) {
	let mut active_clients: u64 = 0;

	loop {
		if active_clients == 0 {
			tokio::select! {
				_ = sleeper.sleep(idle_timeout) => return,
				event = events.recv() => match event {
					Some(ActivityEvent::Connected) => active_clients += 1,
					Some(ActivityEvent::Disconnected) => {
					}
					None => std::future::pending::<()>().await,
				},
			}
		} else {
			match events.recv().await {
				Some(ActivityEvent::Connected) => active_clients += 1,
				Some(ActivityEvent::Disconnected) => {
					active_clients = active_clients.saturating_sub(1);
				}
				None => std::future::pending::<()>().await,
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::atomic::{AtomicUsize, Ordering};

	struct ScriptedSleeper {
		calls: AtomicUsize,
		script: Vec<bool>,
	}

	impl ScriptedSleeper {
		fn new(script: Vec<bool>) -> Self {
			Self {
				calls: AtomicUsize::new(0),
				script,
			}
		}
	}

	impl IdleSleeper for ScriptedSleeper {
		fn sleep(&self, _duration: Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> {
			let i = self.calls.fetch_add(1, Ordering::SeqCst);
			match self.script.get(i) {
				Some(true) => Box::pin(std::future::ready(())),
				Some(false) => Box::pin(std::future::pending()),
				None => panic!("sleeper.sleep() called more times than scripted ({i} calls)"),
			}
		}
	}

	#[tokio::test]
	async fn fires_after_idle_timeout_when_never_connected() {
		let (_tracker, rx) = new_activity_channel();
		let sleeper = ScriptedSleeper::new(vec![true]);

		wait_for_idle_timeout(Duration::from_secs(3600), rx, &sleeper).await;
	}

	#[tokio::test]
	async fn paused_while_connected_then_resets_and_fires_after_disconnect() {
		let (tracker, rx) = new_activity_channel();
		let sleeper = ScriptedSleeper::new(vec![false, true]);

		let guard = tracker.client_connected();

		let mut task = tokio::spawn(async move {
			wait_for_idle_timeout(Duration::from_secs(3600), rx, &sleeper).await;
		});

		let still_running = tokio::time::timeout(Duration::from_millis(50), &mut task).await;
		assert!(
			still_running.is_err(),
			"idle timeout must not fire while a client is connected"
		);

		drop(guard);

		task.await.unwrap();
	}

	#[tokio::test]
	async fn never_fires_while_a_single_client_stays_connected() {
		let (tracker, rx) = new_activity_channel();
		let sleeper = ScriptedSleeper::new(vec![false]);

		let guard = tracker.client_connected();
		let mut task = tokio::spawn(async move {
			wait_for_idle_timeout(Duration::from_secs(3600), rx, &sleeper).await;
		});

		let still_running = tokio::time::timeout(Duration::from_millis(50), &mut task).await;
		assert!(
			still_running.is_err(),
			"idle timeout must not fire while a client is connected"
		);

		task.abort();
		drop(guard);
	}

	#[tokio::test]
	async fn disconnect_while_still_zero_active_is_ignored_without_underflow() {
		let (tracker, rx) = new_activity_channel();
		let sleeper = ScriptedSleeper::new(vec![false, true]);

		{
			let _extra_guard = tracker.client_connected();
		}

		wait_for_idle_timeout(Duration::from_secs(3600), rx, &sleeper).await;
	}
}
