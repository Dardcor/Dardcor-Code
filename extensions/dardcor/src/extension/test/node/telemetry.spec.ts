/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { createPlatformServices } from '../../../platform/test/node/services';
import { allEvents, withTelemetryCapture } from '../../../platform/test/node/telemetry';
import { createTelemetryWithId, getCodeBlocks, sendConversationalMessageTelemetry, sendUserActionTelemetry } from '../../prompt/node/telemetry';

suite.skip('Conversation telemetry tests', { timeout: 10000 }, function () {

	test('Test telemetryMessage', async function () {
		const testingServiceCollection = createPlatformServices();
		const document = undefined;
		const messageText = 'hello world!';
		const messageLen = 12;
		const prompt = 'You are a programming assistant. Respond to the question hello world!';
		const source = 'user';
		const turnIndex = 0;
		const intentClassifierScore = 1;
		const intentClassifierLatency = 10;

		const [messages] = await withTelemetryCapture(testingServiceCollection, async accessor => {
			const telemetryData = sendConversationalMessageTelemetry(
				accessor.get(ITelemetryService),
				document,
				ChatLocation.Panel,
				messageText,
				{ source: source, turnIndex: turnIndex.toString() },
				{
					messageCharLen: messageLen,
					promptCharLen: prompt.length,
					intentClassifierScore: intentClassifierScore,
					intentClassifierLatency: intentClassifierLatency,
				},
				createTelemetryWithId()
			);

			assert.strictEqual(telemetryData.properties.source, source);
			assert.strictEqual(telemetryData.properties.turnIndex, turnIndex.toString());
			assert.strictEqual(telemetryData.measurements.messageCharLen, messageText.length);
			assert.strictEqual(telemetryData.measurements.promptCharLen, prompt.length);
			assert.strictEqual(telemetryData.measurements.intentClassifierScore, intentClassifierScore);
			assert.strictEqual(telemetryData.measurements.intentClassifierLatency, intentClassifierLatency);

			assert(!('messageText' in telemetryData.properties));
		});

		assert.ok(allEvents(messages));
		const names = messages
			.map(message => message.data.baseData.name.split('/')[1])
			.filter(name => !['auth.new_login', 'auth.new_token'].includes(name));
		assert.deepStrictEqual(
			names.filter(name => !name.startsWith('engine.') && name !== 'log').sort(),
			['conversation.message', 'conversation.messageText'].sort()
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.message')
				.every(message => message.data.baseData.properties.source === source)
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.message')
				.every(message => message.data.baseData.properties.turnIndex === turnIndex.toString())
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.message')
				.every(message => message.data.baseData.measurements.messageCharLen === messageLen)
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.message')
				.every(message => message.data.baseData.measurements.promptCharLen === prompt.length)
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.message')
				.every(message => message.data.baseData.measurements.intentClassifierScore === intentClassifierScore)
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.message')
				.every(message => message.data.baseData.measurements.intentClassifierLatency === intentClassifierLatency)
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.messageText')
				.every(message => message.data.baseData.properties.messageText === messageText)
		);
	});

	test('Test telemetryUserAction', async function () {
		const testingServiceCollection = createPlatformServices();
		const document = undefined;
		const rating = 'positive';
		const messageId = '12345';
		const name = 'conversation.messageRating';

		const [messages] = await withTelemetryCapture(testingServiceCollection, async accessor => {
			const telemetryData = sendUserActionTelemetry(accessor.get(ITelemetryService), document, { rating: rating, messageId: messageId }, {}, name);

			assert.strictEqual(telemetryData.properties.rating, rating);
			assert.strictEqual(telemetryData.properties.messageId, messageId);
		});

		assert.ok(allEvents(messages));
		const names = messages
			.map(message => message.data.baseData.name.split('/')[1])
			.filter(name => !['auth.new_login', 'auth.new_token'].includes(name));
		assert.deepStrictEqual(
			names.filter(name => !name.startsWith('engine.') && name !== 'log').sort(),
			['conversation.messageRating'].sort()
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.messageRating')
				.every(message => message.data.baseData.properties.rating === rating)
		);
		assert.ok(
			messages
				.filter(message => message.data.baseData.name.split('/')[1] === 'conversation.messageRating')
				.every(message => message.data.baseData.properties.messageId === messageId)
		);
	});

	test('Test getCodeBlocks with no code', async function () {
		const noCode = 'hello world';

		const noCodeResult = getCodeBlocks(noCode);
		assert.strictEqual(noCodeResult.length, 0, 'Length of no code result should be 0');
	});

	test('Test getCodeBlocks with one code block, no language', async function () {
		const basicNoLang = '\n```\nhello world\n```';

		const basicNoLangResult = getCodeBlocks(basicNoLang);
		assert.deepEqual(basicNoLangResult, [''], 'Basic no lang result should be an array with an empty string');
	});

	test('Test getCodeBlocks with one code block with language', async function () {
		const basicWithLang = '\n```python\nhello world\n```';

		const basicWithLangResult = getCodeBlocks(basicWithLang);
		assert.deepEqual(
			basicWithLangResult,
			['python'],
			'Basic with lang result should be an array with a single string'
		);
	});

	test('Test getCodeBlocks with nested code blocks', async function () {
		const nested = '\n```\n```python\ndef hello_world():\n    print("Hello, world!")\n```\n```\n\n';

		const nestedResult = getCodeBlocks(nested);
		assert.deepEqual(
			nestedResult,
			[''],
			'Nested result should be an array with one empty string, ignoring backticks within the code block'
		);
	});

	test('Test getCodeBlocks with multiple nested code blocks', async function () {
		const multiNested =
			'\n```\n```python\ndef hello_world():\n    print(\'Hello, world!\'\')\n```\n```\n\nThis will render as:\n\n```python\ndef hello_world():\n    print(\'Hello, world!\'\')\n```';

		const multiNestedResult = getCodeBlocks(multiNested);
		assert.deepEqual(
			multiNestedResult,
			['', ''],
			'Multi nested result should be an array with two empty strings, ignoring backticks within the code block'
		);
	});

	test('Test getCodeBlocks with escaped backticks', async function () {
		const escaped =
			'\n\n\\`\\`\\`python\nprint("Hello, world!")\n\\`\\`\\`\n\nThis will produce:\n\n```python\nprint("Hello, world!")\n```';

		const escapedResult = getCodeBlocks(escaped);
		assert.deepEqual(
			escapedResult,
			['python'],
			'Escaped result should be an array with a single string, ignoring escaped backticks'
		);
	});
});
