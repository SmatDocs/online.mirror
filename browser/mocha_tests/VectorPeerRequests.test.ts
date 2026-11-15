/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Vector peer resource requests', function () {
	let socket: typeof app.socket;
	let tracker: VectorResourceTracker<string, string>;
	let sent: string[];

	beforeEach(function () {
		socket = app.socket;
		sent = [];
		app.socket = {
			sendMessage: (message: string) => sent.push(message),
		} as any;
	});

	afterEach(function () {
		tracker?.clear();
		app.socket = socket;
	});

	it('answers a peer hit without a server request', async function () {
		tracker = new VectorResourceTracker(
			(id) => 'font ' + id,
			async (id) => {
				tracker.setLoaded(id, 'font bytes');
				return true;
			},
		);
		tracker.requestMissing(new Set(['a']));
		await Promise.resolve();
		nodeassert.deepStrictEqual(sent, []);
		nodeassert.strictEqual(tracker.get('a'), 'font bytes');
	});

	it('falls back to the server once after a peer miss', async function () {
		tracker = new VectorResourceTracker(
			(id) => 'font ' + id,
			async () => false,
		);
		tracker.requestMissing(new Set(['a']));
		tracker.requestMissing(new Set(['a']));
		await Promise.resolve();
		nodeassert.deepStrictEqual(sent, ['font a']);
	});

	it('falls back if the peer lookup rejects', async function () {
		tracker = new VectorResourceTracker(
			(id) => 'font ' + id,
			async () => {
				throw Error('peer unavailable');
			},
		);
		tracker.requestMissing(new Set(['a']));
		await Promise.resolve();
		nodeassert.deepStrictEqual(sent, ['font a']);
	});

	it('discards a pending peer miss after the tracker clears', async function () {
		let resolve: (hit: boolean) => void;
		tracker = new VectorResourceTracker(
			(id) => 'font ' + id,
			() => new Promise<boolean>((done) => (resolve = done)),
		);
		tracker.requestMissing(new Set(['a']));
		tracker.clear();
		resolve(false);
		await Promise.resolve();
		nodeassert.deepStrictEqual(sent, []);
	});

	it('uses the normal server path when no peer lookup is configured', function () {
		tracker = new VectorResourceTracker((id) => 'image ' + id);
		tracker.requestMissing(new Set(['a']));
		nodeassert.deepStrictEqual(sent, ['image a']);
	});
});
