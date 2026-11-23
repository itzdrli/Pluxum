import { describe, expect, it } from 'vitest'

import { appHotkeys, HOTKEY_IDS, HOTKEY_TEXT } from '../app/lib/hotkeys'

describe('hotkey catalog', () => {
	it('lists every declared shortcut once, each with a label', () => {
		const declared = Object.keys(appHotkeys).toSorted()
		expect(HOTKEY_IDS.toSorted()).toEqual(declared)
		expect(new Set(HOTKEY_IDS).size).toBe(HOTKEY_IDS.length)
		expect(Object.keys(HOTKEY_TEXT).toSorted()).toEqual(declared)
	})
})
