// Session-probe de-duplication.
//
// RefreshHandler runs globally on every navigation, pages check the session
// on mount, and RequireAdmin guards admin routes — so several identical
// /auth/me calls fired milliseconds apart, each spending a request from the
// shopper's rate-limit budget to learn the same thing.
//
// Runs under CRA's jest (jsdom), so window/document already exist; only
// fetch needs stubbing.

import { fetchCurrentUser, fetchCurrentAdmin } from './utils';

const jsonOnce = (body, status = 200) =>
    Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' },
        clone() { return this; },
        json: async () => body,
        text: async () => JSON.stringify(body)
    });

describe('fetchCurrentUser', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('collapses concurrent calls into a single network request', async () => {
        const spy = jest
            .spyOn(global, 'fetch')
            .mockImplementation(() => jsonOnce({ success: true, user: { email: 'a@b.c' } }));

        const results = await Promise.all([
            fetchCurrentUser(),
            fetchCurrentUser(),
            fetchCurrentUser(),
            fetchCurrentUser(),
            fetchCurrentUser()
        ]);

        const meCalls = spy.mock.calls.filter(([url]) => String(url).includes('/auth/me'));
        expect(meCalls).toHaveLength(1);
        // Every caller still gets the answer.
        results.forEach((user) => expect(user).toEqual({ email: 'a@b.c' }));
    });

    test('a later call after the first settles does hit the network again', async () => {
        const spy = jest
            .spyOn(global, 'fetch')
            .mockImplementation(() => jsonOnce({ success: true, user: { email: 'a@b.c' } }));

        await fetchCurrentUser();
        await fetchCurrentUser();

        // Deliberately not cached: a TTL would have to outlive the 800ms the
        // login screens wait before navigating, so a stale "logged out"
        // answer could survive the login that replaced it.
        const meCalls = spy.mock.calls.filter(([url]) => String(url).includes('/auth/me'));
        expect(meCalls).toHaveLength(2);
    });

    test('a failed probe resolves null for every concurrent caller and does not stick', async () => {
        const spy = jest
            .spyOn(global, 'fetch')
            .mockImplementation(() => jsonOnce({ success: false }, 401));

        const [a, b] = await Promise.all([fetchCurrentUser(), fetchCurrentUser()]);
        expect(a).toBeNull();
        expect(b).toBeNull();
        expect(spy.mock.calls.filter(([u]) => String(u).includes('/auth/me'))).toHaveLength(1);

        // The in-flight slot must have been released, not left holding a
        // rejected/stale promise.
        await fetchCurrentUser();
        expect(spy.mock.calls.filter(([u]) => String(u).includes('/auth/me'))).toHaveLength(2);
    });
});

describe('fetchCurrentAdmin', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('collapses concurrent calls independently of the shopper probe', async () => {
        const spy = jest.spyOn(global, 'fetch').mockImplementation((url) =>
            String(url).includes('/admin/me')
                ? jsonOnce({ success: true, admin: { adminId: 'admin@x.y' } })
                : jsonOnce({ success: true, user: { email: 'a@b.c' } })
        );

        const [admins, users] = await Promise.all([
            Promise.all([fetchCurrentAdmin(), fetchCurrentAdmin(), fetchCurrentAdmin()]),
            Promise.all([fetchCurrentUser(), fetchCurrentUser()])
        ]);

        const adminCalls = spy.mock.calls.filter(([u]) => String(u).includes('/admin/me'));
        const userCalls = spy.mock.calls.filter(([u]) => String(u).includes('/auth/me'));
        expect(adminCalls).toHaveLength(1);
        expect(userCalls).toHaveLength(1);

        admins.forEach((a) => expect(a).toEqual({ adminId: 'admin@x.y' }));
        users.forEach((u) => expect(u).toEqual({ email: 'a@b.c' }));
    });
});
