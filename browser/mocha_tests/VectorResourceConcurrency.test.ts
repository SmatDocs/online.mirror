/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Vector resource concurrency', function () {
	let original: any,
		tracker: VectorResourceTracker<string, string>,
		messages: string[];
	beforeEach(function () {
		original = app.socket;
		messages = [];
		(app as any).socket = {
			sendMessage: (message: string) => messages.push(message),
		};
		tracker = new VectorResourceTracker<string, string>((id) => 'font ' + id);
		tracker.indexForPart('S0', new Set(['a', 'b', 'c']));
	});
	afterEach(function () {
		tracker.clear();
		(app as any).socket = original;
	});
	it('keeps one request in flight and pauses unsent fonts during an edit', function () {
		tracker.setConcurrencyLimit(1);
		tracker.requestMissing(new Set(['a', 'b', 'c']));
		nodeassert.deepStrictEqual(messages, ['font a']);
		tracker.setConcurrencyLimit(0);
		tracker.setLoaded('a', 'A');
		nodeassert.deepStrictEqual(messages, ['font a']);
		tracker.setConcurrencyLimit(1);
		nodeassert.deepStrictEqual(messages, ['font a', 'font b']);
		tracker.setUnavailable('b');
		nodeassert.deepStrictEqual(messages, ['font a', 'font b', 'font c']);
		tracker.setLoaded('c', 'C');
		nodeassert.strictEqual((tracker as any)._requests.requestCount, 0);
	});
	it('starts no timeout clocks for waiting fonts and drops retired owners', function () {
		tracker.setConcurrencyLimit(0);
		tracker.requestMissing(new Set(['a', 'b', 'c']));
		nodeassert.strictEqual((tracker as any)._requests.requestCount, 0);
		tracker.forgetPart('S0');
		tracker.setConcurrencyLimit(Infinity);
		nodeassert.deepStrictEqual(messages, []);
		nodeassert.strictEqual((tracker as any)._waiting.size, 0);
	});
	it('advances after a permanent failure without retrying it forever', function () {
		tracker.setConcurrencyLimit(1);
		tracker.requestMissing(new Set(['a', 'b']));
		const expire = () => {
			for (const request of (tracker as any)._requests.requests())
				request.sent -= 60001;
			(tracker as any)._requests.expire();
		};
		expire();
		nodeassert.deepStrictEqual(messages, ['font a', 'font a']);
		expire();
		nodeassert.deepStrictEqual(messages, ['font a', 'font a', 'font b']);
		tracker.setLoaded('b', 'B');
		tracker.requestMissing(new Set(['a']));
		nodeassert.strictEqual(messages.length, 3);
	});
	it('restores normal parallel loading and clears unsent work on discard', function () {
		tracker.setConcurrencyLimit(0);
		tracker.requestMissing(new Set(['a', 'b', 'c']));
		tracker.setConcurrencyLimit(Infinity);
		nodeassert.deepStrictEqual(messages, ['font a', 'font b', 'font c']);
		tracker.clear();
		nodeassert.strictEqual((tracker as any)._waiting.size, 0);
		nodeassert.strictEqual((tracker as any)._requests.requestCount, 0);
	});
});
