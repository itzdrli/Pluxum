import { afterEach, describe, expect, it } from 'vitest'

import {
	browserTimeZone,
	DEFAULT_TIME_ZONE,
	isTimeZone,
	rememberTimeZone,
	TIME_ZONE_COOKIE,
	timeZoneCookie,
	timeZoneFromRequest,
} from '../app/lib/timezone'

const request = (cookie?: string) => ({
	headers: new Headers(cookie === undefined ? {} : { cookie }),
})

describe('time zone', () => {
	it('knows IANA zones and rejects anything else', () => {
		expect(isTimeZone('Europe/Berlin')).toBe(true)
		expect(isTimeZone('UTC')).toBe(true)
		expect(isTimeZone('Mars/Olympus')).toBe(false)
		expect(isTimeZone('')).toBe(false)
		expect(isTimeZone(undefined)).toBe(false)
		expect(isTimeZone('x'.repeat(100))).toBe(false)
	})

	it('reads the cookie, and falls back to the default for a missing or bad one', () => {
		expect(timeZoneFromRequest(request(`a=b; ${TIME_ZONE_COOKIE}=Europe%2FBerlin`))).toBe(
			'Europe/Berlin',
		)
		expect(timeZoneFromRequest(request())).toBe(DEFAULT_TIME_ZONE)
		expect(timeZoneFromRequest(request(`${TIME_ZONE_COOKIE}=Nope%2FNowhere`))).toBe(
			DEFAULT_TIME_ZONE,
		)
	})

	it('writes a year-long cookie with the slash escaped', () => {
		expect(timeZoneCookie('Asia/Tokyo')).toBe(
			`${TIME_ZONE_COOKIE}=Asia%2FTokyo; Path=/; Max-Age=31536000; SameSite=Lax`,
		)
	})
})

describe('the browser side', () => {
	const original = process.env.TZ
	afterEach(() => {
		if (original === undefined) delete process.env.TZ
		else process.env.TZ = original
		document.cookie = `${TIME_ZONE_COOKIE}=; Max-Age=0; Path=/`
	})

	it('reads the zone the browser runs in', () => {
		process.env.TZ = 'Asia/Tokyo'
		expect(browserTimeZone()).toBe('Asia/Tokyo')
	})

	it('stores a zone the server does not know, and leaves a known one alone', () => {
		process.env.TZ = 'Asia/Tokyo'
		rememberTimeZone('Asia/Tokyo')
		expect(document.cookie).not.toContain('Tokyo')
		rememberTimeZone(DEFAULT_TIME_ZONE)
		expect(document.cookie).toContain(`${TIME_ZONE_COOKIE}=Asia%2FTokyo`)
	})
})
