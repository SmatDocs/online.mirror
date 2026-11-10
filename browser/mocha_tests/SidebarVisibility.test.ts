/* -*- js-indent-level: 8 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 */

describe('Sidebar initial visibility', function() {
	function sidebarWith(showRequested: boolean, preference: boolean) {
		return {
			shouldShowSidebar: Sidebar.prototype.shouldShowSidebar,
			deckState: { showRequested: showRequested },
			map: {
				uiManager: {
					getBooleanDocTypePref(name: string, defaultValue: boolean) {
						nodeassert.strictEqual(name, 'ShowSidebar');
						nodeassert.strictEqual(defaultValue, false);
						return preference;
					},
				},
			},
		};
	}

	it('keeps automatic startup deck payloads hidden', function() {
		const sidebar = sidebarWith(false, false);
		nodeassert.strictEqual(Sidebar.prototype.sidebarMayOpen.call(sidebar), false);
	});

	it('allows an explicit open request after startup', function() {
		const sidebar = sidebarWith(true, false);
		nodeassert.strictEqual(Sidebar.prototype.sidebarMayOpen.call(sidebar), true);
	});

	it('keeps a sidebar the user opened when its deck changes', function() {
		const sidebar = sidebarWith(false, true);
		nodeassert.strictEqual(Sidebar.prototype.sidebarMayOpen.call(sidebar), true);
	});

	it('closes a visible sidebar before a document reload', function() {
		let storedPreference: boolean | null = null;
		let closeCalls = 0;
		const uiManager = {
			setDocTypePref(name: string, value: boolean) {
				nodeassert.strictEqual(name, 'ShowSidebar');
				storedPreference = value;
			},
			map: {
				sidebar: {
					isVisible() {
						return true;
					},
					closeSidebar() {
						closeCalls++;
					},
				},
			},
		};

		UIManager.prototype.resetSidebarForDocumentLoad.call(uiManager);

		nodeassert.strictEqual(storedPreference, false);
		nodeassert.strictEqual(closeCalls, 1);
	});
});
