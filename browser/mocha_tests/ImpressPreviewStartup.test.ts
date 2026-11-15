/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Impress preview startup', function () {
	it('loads a small preview without fetching the full slide and delivers its PNG', function () {
		const original = {
			map: app.map,
			socket: app.socket,
			impress: (app as any).impress,
			params: window.coolParams,
		};
		const previews: any[] = [];
		const events: any[] = [];
		const messages: string[] = [];
		try {
			(window as any).coolParams = new URLSearchParams('rasterpreviews=true');
			(app as any).impress = {
				partList: [{ part: 'S0', mode: cool.VectorMode.Slides }],
			};
			(app as any).map = {
				_docLayer: {
					_docType: 'presentation',
					getPartDimensions: () => ({ x: 16000, y: 9000 }),
					getIndexFromPart: (part: string) => (part === 'S0' ? 0 : -1),
				},
				_debug: { tileDataOn: false },
				getCustomPreview: (...args: any[]) => previews.push(args),
				fire: (name: string, value: any) => events.push({ name, value }),
			};
			(app as any).socket = {
				sendMessage: (message: string) => messages.push(message),
				parseServerCmd: () => ({
					id: '0',
					part: 'S0',
					width: 160,
					height: 90,
					wireId: '71',
					x: 0,
					y: 0,
					tileWidth: 16000,
					tileHeight: 9000,
				}),
			};
			const manager = new ImpressVectorManager();
			manager.requestThumbnail(0, 0, cool.VectorMode.Slides, 160, 90);
			nodeassert.strictEqual(previews.length, 1);
			nodeassert.strictEqual(
				messages.length,
				0,
				'no full-slide resource request',
			);
			const image = { preview: true };
			manager.onTileMsg('tile: id=0 part=S0', image);
			nodeassert.strictEqual(events.length, 1);
			nodeassert.strictEqual(events[0].name, 'tilepreview');
			nodeassert.strictEqual(events[0].value.tile, image);
			nodeassert.strictEqual(events[0].value.partIndex, 0);
			manager.sendProcessedResponse();
			nodeassert.deepStrictEqual(messages, ['tileprocessed wids=71']);
		} finally {
			(app as any).map = original.map;
			(app as any).socket = original.socket;
			(app as any).impress = original.impress;
			(window as any).coolParams = original.params;
		}
	});
});
