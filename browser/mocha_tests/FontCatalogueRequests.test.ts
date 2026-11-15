/* -*- js-indent-level: 8 -*- */
/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Font catalogue requests', function () {
	const fs = require('fs');
	const path = require('path');
	const vm = require('vm');
	const source = fs.readFileSync(
		path.resolve(__dirname, '../../src/layer/tile/CanvasTileLayer.js'),
		'utf8',
	);
	function createLayer() {
		let now = 10000;
		const messages: string[] = [];
		const events: string[] = [];
		const context: any = {
			Date: { now: () => now },
			app: {
				socket: { sendMessage: (message: string) => messages.push(message) },
			},
		};
		for (const method of ['_getToolbarCommandsValues', '_onCommandValuesMsg']) {
			const start = source.indexOf('\t' + method + ': function');
			const end = source.indexOf('\n\t},', start);
			if (start < 0 || end < 0) throw Error('Real method not found');
			vm.runInNewContext(
				'method = ({' + source.slice(start, end + 4) + '}).' + method,
				context,
			);
			context[method] = context.method;
		}
		const layer: any = {
			_getToolbarCommandsValues: context._getToolbarCommandsValues,
			_onCommandValuesMsg: context._onCommandValuesMsg,
			_readInputSequence() {},
			_toolbarCommandValues: {},
			_map: {
				unoToolbarCommands: ['.uno:StyleApply', '.uno:CharFontName'],
				fire: (event: string) => events.push(event),
			},
		};
		return { layer, messages, events, advance: (ms: number) => (now += ms) };
	}
	it('shares the outstanding catalogue while keeping style refreshes', function () {
		const { layer, messages } = createLayer();
		for (let i = 0; i < 3; i++) layer._getToolbarCommandsValues();
		nodeassert.strictEqual(
			messages.filter((m) => m.endsWith('.uno:CharFontName')).length,
			1,
		);
		nodeassert.strictEqual(
			messages.filter((m) => m.endsWith('.uno:StyleApply')).length,
			3,
		);
	});
	it('updates the toolbar and permits a fresh request after the response', function () {
		const { layer, messages, events } = createLayer();
		layer._getToolbarCommandsValues();
		layer._onCommandValuesMsg(
			'commandvalues: {"commandName":".uno:CharFontName","commandValues":{"Carlito":[]}}',
		);
		nodeassert.deepStrictEqual(
			Object.keys(layer._toolbarCommandValues['.uno:CharFontName']),
			['Carlito'],
		);
		nodeassert.deepStrictEqual(events, ['updatetoolbarcommandvalues']);
		layer._getToolbarCommandsValues();
		nodeassert.strictEqual(
			messages.filter((m) => m.endsWith('.uno:CharFontName')).length,
			2,
		);
	});
	it('bounds the wait for a missing response without a retry timer', function () {
		const { layer, messages, advance } = createLayer();
		layer._getToolbarCommandsValues();
		advance(10000);
		layer._getToolbarCommandsValues();
		nodeassert.strictEqual(
			messages.filter((m) => m.endsWith('.uno:CharFontName')).length,
			2,
		);
	});
});
