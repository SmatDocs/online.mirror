/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Vector resource retries', function () {
	it('lets a slow font arrive without duplicating it, then bounds unanswered attempts', function () {
		const original = app.socket;
		const messages: string[] = [];
		const tracker: any = new VectorResourceTracker<string, string>(
			(id) => 'font ' + id,
		);
		try {
			(app as any).socket = {
				sendMessage: (message: string) => messages.push(message),
			};
			tracker.indexForPart('S0', new Set(['slow']));
			tracker.requestMissing(new Set(['slow']));
			const request = Array.from(tracker._requests.requests())[0] as any;
			request.sent -= 11000;
			tracker._requests.expire();
			nodeassert.strictEqual(
				messages.length,
				1,
				'the original font is still arriving',
			);
			request.sent -= 60000;
			tracker._requests.expire();
			nodeassert.strictEqual(messages.length, 2, 'one bounded retry');
			const retry = Array.from(tracker._requests.requests())[0] as any;
			retry.sent -= 60001;
			tracker._requests.expire();
			tracker.requestMissing(new Set(['slow']));
			nodeassert.strictEqual(messages.length, 2, 'a permanent failure stops');
			tracker.setLoaded('slow', 'late font');
			nodeassert.strictEqual(tracker.get('slow'), 'late font');
			nodeassert.strictEqual(tracker._unavailable.has('slow'), false);
		} finally {
			tracker.clear();
			(app as any).socket = original;
		}
	});
});
