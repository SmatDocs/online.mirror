/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Impress opening preview', function () {
	let original: any,
		preview: ImpressOpeningPreview,
		received: (event: any) => void;
	let loaded: boolean,
		messages: string[],
		drawn: string[],
		timers: Map<number, { fn: () => void; delay: number }>;
	let serial: number;
	const part = {
		partId: 'S0',
		mode: 0,
		epoch: 1,
		version: 1,
	} as cool.VectorPrimitivesData;
	const tick = () => {
		for (const [id, timer] of Array.from(timers)) {
			if (timer.delay === 0) {
				timers.delete(id);
				timer.fn();
			}
		}
	};
	const draw = () =>
		preview.draw(
			{
				drawImage: (image: any) => drawn.push(image.tag),
			} as unknown as CanvasRenderingContext2D,
			'S0',
			0,
		);
	const requestIds: string[] = [];
	beforeEach(function () {
		original = {
			map: app.map,
			socket: app.socket,
			impress: (app as any).impress,
			section: app.sectionContainer,
			document: app.activeDocument,
			params: window.coolParams,
			setTimeout: window.setTimeout,
			clearTimeout: window.clearTimeout,
		};
		loaded = false;
		messages = [];
		drawn = [];
		timers = new Map();
		serial = 0;
		requestIds.length = 0;
		(window as any).setTimeout = (fn: () => void, delay: number) => {
			timers.set(++serial, { fn, delay });
			return serial;
		};
		(window as any).clearTimeout = (id: number) => timers.delete(id);
		(window as any).coolParams = new URLSearchParams('openingpriority=true');
		(app as any).map = {
			on: (_name: string, fn: (event: any) => void) => {
				received = fn;
			},
			off: () => {},
			_docLayer: {
				_selectedPart: 0,
				_docType: 'presentation',
				_canonicalIdInitialized: true,
				_preview: { _previewInitialized: true },
				getPartDimensions: () => ({ x: 16000, y: 9000 }),
			},
		};
		(app as any).socket = {
			sendMessage: (message: string) => {
				messages.push(message);
				if (message.startsWith('tile '))
					requestIds.push(message.match(/ id=(\d+)/)![1]);
			},
		};
		(app as any).impress = { partList: [{ part: 'S0', mode: 0 }] };
		(app as any).activeDocument = {
			activeLayout: { viewedRectangle: { pX1: 0, pY1: 0 } },
		};
		(app as any).sectionContainer = { requestReDraw: () => {} };
		preview = new ImpressOpeningPreview(
			() => loaded,
			() => 'M0',
			() => {},
		);
		preview.outgoing('clientzoom tilepixelwidth=256');
		preview.outgoing('clientvisiblearea width=100 height=100');
		tick();
	});
	afterEach(function () {
		preview.discard('test finished');
		(app as any).map = original.map;
		(app as any).socket = original.socket;
		(app as any).impress = original.impress;
		(app as any).sectionContainer = original.section;
		(app as any).activeDocument = original.document;
		(window as any).coolParams = original.params;
		window.setTimeout = original.setTimeout;
		window.clearTimeout = original.clearTimeout;
	});
	const answer = (index: number, tag: string) =>
		received({
			id: requestIds[index],
			tile: { complete: true, naturalWidth: 960, tag },
		});
	it('rejects a late image from before an engine edit and draws its replacement', function () {
		preview.partArrived({ ...part, version: 2 }, false);
		answer(0, 'old');
		draw();
		tick();
		nodeassert.deepStrictEqual(drawn, []);
		nodeassert.strictEqual(preview.stats.discarded, 1);
		nodeassert.strictEqual(requestIds.length, 2);
		answer(1, 'new');
		draw();
		nodeassert.deepStrictEqual(drawn, ['new']);
	});
	it('drops an image immediately for local input and coalesces revisions behind one request', function () {
		answer(0, 'initial');
		draw();
		preview.localChange();
		draw();
		nodeassert.strictEqual(drawn.length, 1);
		preview.partArrived({ ...part, version: 2 }, false);
		tick();
		preview.partArrived({ ...part, version: 3 }, false);
		tick();
		nodeassert.strictEqual(requestIds.length, 2);
		answer(1, 'superseded');
		tick();
		answer(2, 'latest');
		draw();
		nodeassert.strictEqual(drawn.at(-1), 'latest');
	});
	it('refreshes after a master change and retires the image when vectors finish', function () {
		answer(0, 'initial');
		draw();
		preview.partArrived({ ...part, partId: 'M0', version: 2 }, false);
		tick();
		answer(1, 'master edit');
		draw();
		nodeassert.strictEqual(drawn.at(-1), 'master edit');
		loaded = true;
		nodeassert.strictEqual(draw(), false);
		nodeassert.strictEqual(preview.stats.closedReason, 'vectors ready');
		nodeassert.strictEqual(timers.size, 0);
	});
	it('keeps the preview for navigation and key release, and drops it for typing', function () {
		answer(0, 'initial');
		draw();
		preview.outgoing('key type=up char=65 key=65');
		preview.outgoing('key type=input char=0 key=1281');
		draw();
		nodeassert.strictEqual(drawn.length, 2);
		preview.outgoing('key type=input char=65 key=65');
		draw();
		nodeassert.strictEqual(drawn.length, 2);
	});

	it('bounds deferred reads and releases them after five seconds without retrying', function () {
		for (let i = 0; i < 32; i++)
			nodeassert.strictEqual(
				preview.outgoing(
					'commandvalues command=.uno:VectorRenderingFont?id=' + i,
				),
				false,
			);
		nodeassert.strictEqual(
			preview.outgoing(
				'commandvalues command=.uno:VectorRenderingFont?id=overflow',
			),
			true,
		);
		const timeout = Array.from(timers.values()).find(
			(timer) => timer.delay === 5000,
		)!;
		timeout.fn();
		nodeassert.strictEqual(
			messages.filter((message) => message.startsWith('commandvalues')).length,
			32,
		);
		nodeassert.strictEqual(preview.outgoing('getpresentationinfo'), true);
	});
});
