import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';

const VOICE_PATH = '/realtime/voice';
const TRANSCRIPTION_PATH = '/realtime/transcription';
const DEFAULT_ROUTER_VOICE_URL = 'ws://127.0.0.1:25128/realtime/voice';

export function getVoiceWebSocketUrl(configurationService: IConfigurationService, productService: IProductService): string {
	const configured = configurationService.getValue<string>('agents.voice.backendUrl');
	const configuredUrl = typeof configured === 'string' ? configured.trim() : '';
	return configuredUrl || productService.voiceWsUrl || DEFAULT_ROUTER_VOICE_URL;
}

export function getTranscriptionWebSocketUrl(configurationService: IConfigurationService, productService: IProductService): string {
	const configured = configurationService.getValue<string>('agents.voice.backendUrl');
	const configuredUrl = typeof configured === 'string' ? configured.trim() : '';
	const voiceUrl = configuredUrl || productService.voiceWsUrl || DEFAULT_ROUTER_VOICE_URL;
	if (!voiceUrl) {
		return '';
	}

	try {
		const url = new URL(voiceUrl);
		const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
		if (path.endsWith(VOICE_PATH)) {
			url.pathname = `${path.slice(0, -VOICE_PATH.length)}${TRANSCRIPTION_PATH}`;
			return url.toString();
		}
		if (!path.endsWith(TRANSCRIPTION_PATH)) {
			url.pathname = `${path}${TRANSCRIPTION_PATH}`;
			return url.toString();
		}
		return url.toString();
	} catch {
		return '';
	}
}

export function addWebSocketAuthToken(url: string, token: string): string {
	if (!token) {
		return url;
	}
	const authenticatedUrl = new URL(url);
	authenticatedUrl.searchParams.set('token', token);
	return authenticatedUrl.toString();
}
