/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

interface ImpressOpeningTicket {
	id: string;
	generation: number;
	partId: cool.VectorPartGuid;
	width: number;
	height: number;
}

// One real slide image until its exact vector resources are ready. An opt-in
// experiment: openingpreview=true, with optional openingpriority=true.
class ImpressOpeningPreview {
	private static _nextId = 2000000000;
	private _selected?: cool.VectorPartGuid;
	private _image?: HTMLImageElement;
	private _current?: ImpressOpeningTicket;
	private _pending?: ImpressOpeningTicket;
	private _generation = 0;
	private _awaitingModel = false;
	private _closed = false;
	private _zoom = false;
	private _area = false;
	private _updateTimer?: number;
	private _requestTimer?: number;
	private _holdTimer?: number;
	private _held: string[] = [];
	private _holdFinished = false;
	private _revisions = new Map<string, string>();
	private _priority = window.coolParams?.get('openingpriority') === 'true';
	readonly stats = {
		requests: 0,
		paints: 0,
		discarded: 0,
		invalidations: 0,
		generation: 0,
		firstPaintMS: 0,
		lastPaintMS: 0,
		closedReason: '',
	};

	constructor(
		private readonly _ready: (partId: cool.VectorPartGuid) => boolean,
		private readonly _master: (
			partId: cool.VectorPartGuid,
		) => cool.VectorPartGuid | undefined,
		private readonly _visualsReady: () => void,
	) {
		app.map.on('tilepreview', this._receive);
	}

	outgoing(message: string): boolean {
		if (this._closed) return true;
		if (
			this._selected &&
			(/^(uno |textinput |paste |changeset )/.test(message) ||
				(/^key type=input /.test(message) &&
					(/\bchar=[1-9]\d*/.test(message) ||
						/\bkey=(1280|1283|1286)\b/.test(message)))) &&
			!/^uno \.uno:Sidebar/.test(message)
		)
			this.localChange();
		if (message.startsWith('clientzoom ')) this._zoom = true;
		if (
			message.startsWith('clientvisiblearea ') &&
			/width=[1-9]\d*/.test(message) &&
			/height=[1-9]\d*/.test(message)
		)
			this._area = true;
		this._schedule();
		if (
			this._priority &&
			!this._holdFinished &&
			this._held.length < 32 &&
			(message === 'getpresentationinfo' ||
				message.startsWith('commandvalues command=.uno:CharFontName') ||
				message.startsWith('commandvalues command=.uno:VectorRenderingFont?'))
		) {
			this._held.push(message);
			this._holdTimer ??= window.setTimeout(() => this._flush(), 5000);
			return false;
		}
		return true;
	}

	localChange(): void {
		if (this._closed || !this._selected) return;
		this._awaitingModel = true;
		this._invalidate();
	}

	partArrived(data: cool.VectorPrimitivesData, whole: boolean): void {
		if (this._closed) return;
		const version = `${data.epoch}:${data.version}`;
		const previous = this._revisions.get(data.partId);
		this._revisions.set(data.partId, version);
		if (
			this._selected &&
			(data.partId === this._selected ||
				data.partId === this._master(this._selected)) &&
			(!whole || (previous !== undefined && previous !== version))
		) {
			this._awaitingModel = false;
			this._invalidate();
		}
		this._schedule();
	}

	private _invalidate(): void {
		this.stats.generation = ++this._generation;
		this.stats.invalidations++;
		this._image = undefined;
		this._current = undefined;
		app.sectionContainer?.requestReDraw();
	}

	private _schedule(): void {
		if (this._closed || this._updateTimer !== undefined) return;
		// Observe a view message only after Socket has actually sent it.
		this._updateTimer = window.setTimeout(() => {
			this._updateTimer = undefined;
			this._request();
		}, 0);
	}

	private _request(): void {
		if (
			this._closed ||
			this._pending ||
			this._awaitingModel ||
			!this._zoom ||
			!this._area
		)
			return;
		const layer = app.map._docLayer as DocLayerInterface &
			cool.CanvasTileLayerInterface & {
				_canonicalIdInitialized?: boolean;
				_preview?: { _previewInitialized?: boolean };
			};
		if (
			!layer._canonicalIdInitialized ||
			!layer._preview?._previewInitialized ||
			layer._docType !== 'presentation'
		)
			return;
		const part = layer._selectedPart;
		const entry = app.impress?.partList?.[part];
		if (!entry || entry.mode !== cool.VectorMode.Slides) return;
		if (this._selected && this._selected !== entry.part) {
			this.discard('slide changed');
			return;
		}
		this._selected = entry.part;
		if (this._ready(entry.part)) {
			this.discard('vectors ready');
			return;
		}
		if (this._current?.generation === this._generation) return;
		const size = layer.getPartDimensions?.(part);
		if (!size || !(size.x > 0 && size.y > 0)) return;
		const width = Math.min(960, Math.round((960 * size.x) / size.y));
		const height = Math.round((width * size.y) / size.x);
		if (width < 1 || height < 1 || width > 960 || height > 960) return;
		const ticket = (this._pending = {
			id: String(ImpressOpeningPreview._nextId++),
			generation: this._generation,
			partId: entry.part,
			width: size.x,
			height: size.y,
		});
		this.stats.requests++;
		this._requestTimer = window.setTimeout(
			() => this.discard('preview timeout'),
			60000,
		);
		app.socket.sendMessage(
			`tile nviewid=0 part=${ticket.partId} mode=0 width=${width} height=${height} tileposx=0 tileposy=0 tilewidth=${size.x} tileheight=${size.y} id=${ticket.id} slideshow=1`,
		);
	}

	private _receive = (event: {
		id: string | number;
		tile: HTMLImageElement;
	}): void => {
		const ticket = this._pending;
		if (!ticket || String(event.id) !== ticket.id) return;
		this._flush();
		const accept = (): void => {
			if (this._closed) return;
			window.clearTimeout(this._requestTimer);
			this._pending = undefined;
			if (this._awaitingModel || ticket.generation !== this._generation) {
				this.stats.discarded++;
				this._schedule();
				return;
			}
			if (!event.tile.naturalWidth) {
				this.discard('preview decode failed');
				return;
			}
			this._image = event.tile;
			this._current = ticket;
			app.sectionContainer?.requestReDraw();
		};
		if (event.tile.complete) accept();
		else {
			event.tile.addEventListener('load', accept, { once: true });
			event.tile.addEventListener(
				'error',
				() => this.discard('preview decode failed'),
				{ once: true },
			);
		}
	};

	draw(
		context: CanvasRenderingContext2D,
		partId: cool.VectorPartGuid | undefined,
		mode: number,
	): boolean {
		if (this._closed) return false;
		if (
			this._selected &&
			(partId !== this._selected || mode !== cool.VectorMode.Slides)
		) {
			this.discard('slide changed');
			return false;
		}
		if (this._selected && this._ready(this._selected)) {
			this.discard('vectors ready');
			return false;
		}
		this._schedule();
		const document = app.activeDocument;
		if (!document || !this._image || !this._current || this._awaitingModel)
			return false;
		const view = document.activeLayout.viewedRectangle;
		context.drawImage(
			this._image,
			-view.pX1,
			-view.pY1,
			this._current.width * app.twipsToPixels,
			this._current.height * app.twipsToPixels,
		);
		if (
			this.stats.paints === 0 ||
			this.stats.generation !== this._lastPaintGeneration
		) {
			this._lastPaintGeneration = this.stats.generation;
			this.stats.paints++;
			this.stats.lastPaintMS = performance.now();
			this.stats.firstPaintMS ||= this.stats.lastPaintMS;
			this._visualsReady();
			app.console.debug(
				'slide opening preview: generation=' +
					this.stats.generation +
					' paint_ms=' +
					Math.round(this.stats.lastPaintMS),
			);
		}
		return true;
	}
	private _lastPaintGeneration = -1;

	private _flush(): void {
		window.clearTimeout(this._holdTimer);
		this._holdFinished = true;
		const held = this._held;
		this._held = [];
		for (const message of held) app.socket.sendMessage(message);
	}

	discard(reason: string): void {
		if (this._closed) return;
		this._closed = true;
		this.stats.closedReason = reason;
		window.clearTimeout(this._updateTimer);
		window.clearTimeout(this._requestTimer);
		this._flush();
		this._pending = undefined;
		this._current = undefined;
		this._image = undefined;
		this._revisions.clear();
		app.map.off('tilepreview', this._receive);
	}
}
