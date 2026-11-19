
export type ThreadRealtimeStartTransport = { "type": "websocket" } | {
	"type": "webrtc",
	sdp: string,
};
