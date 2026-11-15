/* -*- js-indent-level: 8; fill-column: 100 -*- */
/*
 * Copyright the Collabora Online contributors.
 * SPDX-License-Identifier: MPL-2.0
 */

/// Exact font bytes shared only with open editors of this user and engine version.
/// No disk storage; a missing peer falls back to the server after 40 ms.
class VectorFontCache {
	private static readonly maxBytes = 8 * 1024 * 1024;
	private static readonly maxEntries = 32;
	private _bytes = new Map<string, ArrayBuffer>();
	private _total = 0;
	private _channel: BroadcastChannel | undefined;
	private _scope = '';
	private _peer = '';
	private _pending = new Map<
		string,
		{ fontId: string; finish: (bytes?: ArrayBuffer) => void }
	>();
	private _onPageHide = () => this.close();
	readonly stats = { hits: 0, misses: 0, served: 0, bytes: 0 };

	private _currentScope(): string | undefined {
		if (window.coolParams?.get('fontcache') !== 'true') return undefined;
		const map = app.map;
		const user = map?._viewInfo?.[map?._docLayer?._viewId]?.userid;
		if (
			typeof user !== 'string' ||
			!user.trim() ||
			user.length > 256 ||
			['0', 'anonymous', 'undefined'].includes(user.toLowerCase())
		)
			return undefined;
		const version = location.pathname.match(/^\/browser\/([^/]+)\//)?.[1];
		return version
			? 'overten-vector-fonts-v1:' + version + ':' + user
			: undefined;
	}

	private _connect(): boolean {
		const scope = this._currentScope();
		if (
			!scope ||
			typeof BroadcastChannel === 'undefined' ||
			!globalThis.crypto?.randomUUID
		) {
			this.close();
			return false;
		}
		if (this._channel && scope === this._scope) return true;
		this.close();
		try {
			this._scope = scope;
			this._peer = crypto.randomUUID();
			this._channel = new BroadcastChannel(scope);
			this._channel.onmessage = (event) => this._receive(event.data);
			window.addEventListener('pagehide', this._onPageHide, { once: true });
			return true;
		} catch {
			return false;
		}
	}

	private _validId(id: unknown): id is string {
		return typeof id === 'string' && /^[0-9a-f]{1,16}$/i.test(id);
	}

	private _receive(message: unknown): void {
		if (this._scope !== this._currentScope()) {
			this.close();
			return;
		}
		if (!message || typeof message !== 'object') return;
		const data = message as {
			kind?: string;
			id?: string;
			request?: string;
			from?: string;
			to?: string;
			bytes?: ArrayBuffer;
		};
		if (!this._validId(data.id) || typeof data.request !== 'string') return;
		if (data.request.length > 80) return;
		if (
			data.kind === 'get' &&
			typeof data.from === 'string' &&
			data.from.length <= 80
		) {
			const bytes = this._bytes.get(data.id);
			if (!bytes) return;
			this.stats.served++;
			this._channel?.postMessage({
				kind: 'font',
				id: data.id,
				request: data.request,
				to: data.from,
				bytes,
			});
		} else if (data.kind === 'font' && data.to === this._peer) {
			const pending = this._pending.get(data.request);
			if (
				!pending ||
				pending.fontId !== data.id ||
				!(data.bytes instanceof ArrayBuffer) ||
				!data.bytes.byteLength ||
				data.bytes.byteLength > VectorFontCache.maxBytes
			)
				return;
			pending.finish(data.bytes);
		}
	}

	get(fontId: string): Promise<ArrayBuffer | undefined> {
		if (!this._validId(fontId) || !this._connect())
			return Promise.resolve(undefined);
		const held = this._bytes.get(fontId);
		if (held) {
			this.stats.hits++;
			return Promise.resolve(held.slice(0));
		}
		if (this._pending.size >= VectorFontCache.maxEntries)
			return Promise.resolve(undefined);
		return new Promise((resolve) => {
			const request = crypto.randomUUID();
			const timer = window.setTimeout(() => finish(), 40);
			const finish = (bytes?: ArrayBuffer) => {
				if (!this._pending.delete(request)) return;
				window.clearTimeout(timer);
				if (bytes) this.stats.hits++;
				else this.stats.misses++;
				resolve(bytes);
			};
			this._pending.set(request, { fontId, finish });
			try {
				this._channel?.postMessage({
					kind: 'get',
					id: fontId,
					request,
					from: this._peer,
				});
			} catch {
				finish();
			}
		});
	}

	put(fontId: string, bytes: ArrayBuffer): void {
		if (!this._validId(fontId) || !bytes.byteLength) return;
		if (bytes.byteLength > VectorFontCache.maxBytes || !this._connect()) return;
		const previous = this._bytes.get(fontId);
		if (previous) this._total -= previous.byteLength;
		this._bytes.delete(fontId);
		while (
			this._bytes.size &&
			(this._total + bytes.byteLength > VectorFontCache.maxBytes ||
				this._bytes.size >= VectorFontCache.maxEntries)
		) {
			const oldest = this._bytes.entries().next().value as
				| [string, ArrayBuffer]
				| undefined;
			if (!oldest) break;
			this._total -= oldest[1].byteLength;
			this._bytes.delete(oldest[0]);
		}
		this._bytes.set(fontId, bytes.slice(0));
		this._total += bytes.byteLength;
		this.stats.bytes = this._total;
	}

	close(): void {
		this._channel?.close();
		this._channel = undefined;
		this._bytes.clear();
		this._total = 0;
		this.stats.bytes = 0;
		for (const pending of Array.from(this._pending.values())) pending.finish();
		window.removeEventListener('pagehide', this._onPageHide);
	}
}
