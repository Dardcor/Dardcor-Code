/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use crate::{constants::APPLICATION_NAME, util::errors::CodeError};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use uuid::Uuid;


cfg_if::cfg_if! {
	if #[cfg(unix)] {
		pub type AsyncPipe = tokio::net::UnixStream;
		pub type AsyncPipeWriteHalf = tokio::net::unix::OwnedWriteHalf;
		pub type AsyncPipeReadHalf = tokio::net::unix::OwnedReadHalf;

		pub async fn get_socket_rw_stream(path: &Path) -> Result<AsyncPipe, CodeError> {
			tokio::net::UnixStream::connect(path)
				.await
				.map_err(CodeError::AsyncPipeFailed)
		}

		pub async fn listen_socket_rw_stream(path: &Path) -> Result<AsyncPipeListener, CodeError> {
			tokio::net::UnixListener::bind(path)
				.map(AsyncPipeListener)
				.map_err(CodeError::AsyncPipeListenerFailed)
		}

		pub struct AsyncPipeListener(tokio::net::UnixListener);

		impl AsyncPipeListener {
			pub async fn accept(&mut self) -> Result<AsyncPipe, CodeError> {
				self.0.accept().await.map_err(CodeError::AsyncPipeListenerFailed).map(|(s, _)| s)
			}
		}

		pub fn socket_stream_split(pipe: AsyncPipe) -> (AsyncPipeReadHalf, AsyncPipeWriteHalf) {
			pipe.into_split()
		}
	} else {
		use tokio::{time::sleep, io::ReadBuf};
		use tokio::net::windows::named_pipe::{ClientOptions, ServerOptions, NamedPipeClient, NamedPipeServer};
		use std::task::{Context, Poll};
		use std::{time::Duration, io};
		use pin_project::pin_project;

		#[pin_project(project = AsyncPipeProj)]
		pub enum AsyncPipe {
			PipeClient(#[pin] NamedPipeClient),
			PipeServer(#[pin] NamedPipeServer),
		}

		impl AsyncRead for AsyncPipe {
			fn poll_read(
				self: Pin<&mut Self>,
				cx: &mut Context<'_>,
				buf: &mut ReadBuf<'_>,
			) -> Poll<io::Result<()>> {
				match self.project() {
					AsyncPipeProj::PipeClient(c) => c.poll_read(cx, buf),
					AsyncPipeProj::PipeServer(c) => c.poll_read(cx, buf),
				}
			}
		}

		impl AsyncWrite for AsyncPipe {
			fn poll_write(
				self: Pin<&mut Self>,
				cx: &mut Context<'_>,
				buf: &[u8],
			) -> Poll<io::Result<usize>> {
				match self.project() {
					AsyncPipeProj::PipeClient(c) => c.poll_write(cx, buf),
					AsyncPipeProj::PipeServer(c) => c.poll_write(cx, buf),
				}
			}

			fn poll_write_vectored(
				self: Pin<&mut Self>,
				cx: &mut Context<'_>,
				bufs: &[io::IoSlice<'_>],
			) -> Poll<Result<usize, io::Error>> {
				match self.project() {
					AsyncPipeProj::PipeClient(c) => c.poll_write_vectored(cx, bufs),
					AsyncPipeProj::PipeServer(c) => c.poll_write_vectored(cx, bufs),
				}
			}

			fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
				match self.project() {
					AsyncPipeProj::PipeClient(c) => c.poll_flush(cx),
					AsyncPipeProj::PipeServer(c) => c.poll_flush(cx),
				}
			}

			fn is_write_vectored(&self) -> bool {
				match self {
					AsyncPipe::PipeClient(c) => c.is_write_vectored(),
					AsyncPipe::PipeServer(c) => c.is_write_vectored(),
				}
			}

			fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), io::Error>> {
				match self.project() {
					AsyncPipeProj::PipeClient(c) => c.poll_shutdown(cx),
					AsyncPipeProj::PipeServer(c) => c.poll_shutdown(cx),
				}
			}
		}

		pub type AsyncPipeWriteHalf = tokio::io::WriteHalf<AsyncPipe>;
		pub type AsyncPipeReadHalf = tokio::io::ReadHalf<AsyncPipe>;

		pub async fn get_socket_rw_stream(path: &Path) -> Result<AsyncPipe, CodeError> {
			let client = loop {
				match ClientOptions::new().open(path) {
					Ok(client) => break client,
					Err(e) if e.raw_os_error() == Some(231) => sleep(Duration::from_millis(100)).await,
					Err(e) => return Err(CodeError::AsyncPipeFailed(e)),
				}
			};

			Ok(AsyncPipe::PipeClient(client))
		}

		pub struct AsyncPipeListener {
			path: PathBuf,
			server: NamedPipeServer
		}

		impl AsyncPipeListener {
			pub async fn accept(&mut self) -> Result<AsyncPipe, CodeError> {

				self.server
					.connect()
					.await
					.map_err(CodeError::AsyncPipeListenerFailed)?;

				let next_server = ServerOptions::new()
					.create(&self.path)
					.map_err(CodeError::AsyncPipeListenerFailed)?;


				Ok(AsyncPipe::PipeServer(std::mem::replace(&mut self.server, next_server)))
			}
		}

		pub async fn listen_socket_rw_stream(path: &Path) -> Result<AsyncPipeListener, CodeError> {
			let server = ServerOptions::new()
					.first_pipe_instance(true)
					.create(path)
					.map_err(CodeError::AsyncPipeListenerFailed)?;

			Ok(AsyncPipeListener { path: path.to_owned(), server })
		}

		pub fn socket_stream_split(pipe: AsyncPipe) -> (AsyncPipeReadHalf, AsyncPipeWriteHalf) {
			tokio::io::split(pipe)
		}
	}
}

pub fn get_socket_name() -> PathBuf {
	cfg_if::cfg_if! {
		if #[cfg(unix)] {
			std::env::temp_dir().join(format!("{}-{}", APPLICATION_NAME, Uuid::new_v4()))
		} else {
			PathBuf::from(format!(r"\\.\pipe\{}-{}", APPLICATION_NAME, Uuid::new_v4()))
		}
	}
}

pub type AcceptedRW = (
	Box<dyn AsyncRead + Send + Unpin>,
	Box<dyn AsyncWrite + Send + Unpin>,
);

pub trait AsyncRWAccepter {
	fn accept_rw(
		&mut self,
	) -> Pin<Box<dyn Future<Output = Result<AcceptedRW, CodeError>> + Send + '_>>;
}

impl AsyncRWAccepter for AsyncPipeListener {
	fn accept_rw(
		&mut self,
	) -> Pin<Box<dyn Future<Output = Result<AcceptedRW, CodeError>> + Send + '_>> {
		Box::pin(async move {
			let pipe = self.accept().await?;
			let (read, write) = socket_stream_split(pipe);
			Ok((
				Box::new(read) as Box<dyn AsyncRead + Send + Unpin>,
				Box::new(write) as Box<dyn AsyncWrite + Send + Unpin>,
			))
		})
	}
}

impl AsyncRWAccepter for TcpListener {
	fn accept_rw(
		&mut self,
	) -> Pin<Box<dyn Future<Output = Result<AcceptedRW, CodeError>> + Send + '_>> {
		Box::pin(async move {
			let (stream, _) = self
				.accept()
				.await
				.map_err(CodeError::AsyncPipeListenerFailed)?;
			let (read, write) = tokio::io::split(stream);
			Ok((
				Box::new(read) as Box<dyn AsyncRead + Send + Unpin>,
				Box::new(write) as Box<dyn AsyncWrite + Send + Unpin>,
			))
		})
	}
}
