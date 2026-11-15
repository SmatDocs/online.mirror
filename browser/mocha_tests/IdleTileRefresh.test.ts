/* -*- js-indent-level: 8 -*- */
/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Idle tile refresh', function () {
	const fs = require('fs');
	const path = require('path');
	const vm = require('vm');
	const ts = require('typescript');
	const source = fs.readFileSync(
		path.resolve(__dirname, '../../src/control/Control.IdleHandler.ts'),
		'utf8',
	);
	const code = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2020 },
	}).outputText;

	function createView(vector = false) {
		let now = 10000;
		let nextTimer = 0;
		let redraws = 0;
		let tilesReady = false;
		const timers = new Map<number, () => void>();
		const documentEvents: Record<string, () => void> = {};
		const messages: string[] = [];
		const document = {
			hidden: false,
			addEventListener(name: string, callback: () => void) {
				documentEvents[name] = callback;
			},
		};
		const map = {
			_docLoaded: true,
			options: { alwaysActive: true },
			_docLayer: {
				_requestNewTiles() {
					redraws++;
				},
			},
		};
		const app: any = {
			map,
			console: { debug() {}, warn() {} },
			socket: {
				connected: () => true,
				sendMessage(message: string) {
					messages.push(message);
				},
			},
		};
		const window: any = {
			app,
			setTimeout(callback: () => void) {
				timers.set(++nextTimer, callback);
				return nextTimer;
			},
			clearTimeout(id: number) {
				timers.delete(id);
			},
			addEventListener() {},
		};
		vm.runInNewContext(code, {
			app,
			window,
			document,
			Date: { now: () => now },
			cool: { VectorRenderingConfig: { isEnabled: () => vector } },
			RenderManager: {
				getTiles: () =>
					new Map([
						['visible', { distanceFromView: 0, hasContent: () => tilesReady }],
						['prefetch', { distanceFromView: 1, hasContent: () => false }],
					]),
				refreshTilesInBackground() {},
				resetPreFetching() {},
			},
		});
		const handler = app.idleHandler;
		handler.map = map;
		// Isolate activation repainting from the separately tested idle/dimming UI.
		handler.notifyActive = () => {
			if (!handler._active) app.socket.sendMessage('useractive');
			handler._active = true;
		};
		return {
			handler,
			document,
			messages,
			get redraws() {
				return redraws;
			},
			ready() {
				tilesReady = true;
			},
			advance(ms: number) {
				now += ms;
			},
			visibility() {
				documentEvents.visibilitychange();
			},
			flush() {
				const pending = [...timers.values()];
				timers.clear();
				pending.forEach((callback) => callback());
			},
		};
	}

	it('lets the initial visible tiles finish without activation repaints', function () {
		const view = createView();
		for (const event of ['focus', 'resize', 'pageshow'])
			view.handler.refreshVisibleTilesAfterActivation(event);
		view.flush();
		nodeassert.deepStrictEqual(view.messages, []);
		nodeassert.strictEqual(view.redraws, 0);
	});

	it('refreshes once for the focus, visibility and resize burst', function () {
		const view = createView();
		view.ready();
		for (const event of ['visibilitychange', 'focus', 'resize', 'pageshow']) {
			view.handler.refreshVisibleTilesAfterActivation(event);
			view.advance(100);
		}
		view.flush();
		nodeassert.deepStrictEqual(view.messages, ['useractive']);
		nodeassert.strictEqual(view.redraws, 1);
	});

	it('still refreshes when a user returns to a hidden tab', function () {
		const view = createView();
		view.ready();
		view.handler.refreshVisibleTilesAfterActivation('focus');
		view.flush();
		view.document.hidden = true;
		view.visibility();
		view.advance(100);
		view.document.hidden = false;
		view.visibility();
		view.flush();
		nodeassert.strictEqual(view.redraws, 2);
	});

	it('does not wait for raster tiles in a vector view', function () {
		const view = createView(true);
		view.handler.refreshVisibleTilesAfterActivation('focus');
		view.flush();
		nodeassert.strictEqual(view.redraws, 1);
	});

	it('does not duplicate the activation message sent by idle recovery', function () {
		const view = createView();
		view.ready();
		view.handler._active = false;
		view.handler.refreshVisibleTilesAfterActivation('focus');
		view.flush();
		nodeassert.deepStrictEqual(view.messages, ['useractive']);
	});
});
