import React from 'react';
import { Store, Wrench, Users } from 'lucide-react';
import AdminShell from './AdminShell';

/**
 * Guide — written for the person using the back office, not for the person
 * who built it.
 *
 * Everything here is something an admin can act on or needs to expect. The
 * internals that used to be on this page — the callback route, the header
 * the gateway injects, the 60-second token cache, TLS and encryption at
 * rest — told an admin nothing they could do anything about, so they are
 * gone. Where an internal detail has a visible consequence it is stated as
 * the consequence instead ("within about a minute").
 */

const CONNECT_STEPS = [
    'Open Auth management and choose Request API authorization.',
    'Fill in the four values from the store\'s developer account: a name for the connection, a client ID, a client secret, and a redirect URI.',
    'You\'ll be sent to the store\'s own sign-in page. Sign in with the store account there — not with your admin login.',
    'You come back here automatically, and the connection appears in the list.',
];

const UPKEEP = [
    {
        title: 'Replacing a connection',
        body: 'Request authorization again using the same connection name. It replaces the old one rather than adding a second.',
    },
    {
        title: 'Removing a connection',
        body: 'Deleting asks you to confirm first. That store\'s products disappear from the shop within about a minute.',
    },
    {
        title: 'If a store is disconnected',
        body: 'With one store still connected the shop keeps working and simply shows fewer products. With none connected, shoppers see "We could not load products", and price alerts stop being checked until a store is back.',
    },
    {
        title: 'Client secrets',
        body: 'Once you save a client secret it is never shown again. Keep your own copy wherever you got it from.',
    },
];

const ACCOUNTS = [
    'The list shows everyone with an account — customers and admins together.',
    'Add admin creates another back-office login. They sign in with their email address, which has to be unique across all accounts.',
    'You can remove admins. You cannot remove customers.',
    'A locked-out admin can reset their own password from the sign-in page — a code is emailed to their admin address.',
];

function Section({ icon: Icon, title, intro, children }) {
    return (
        <section className="max-w-[760px]">
            <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-fld bg-hazeDeep text-ink grid place-items-center shrink-0">
                    <Icon size={18} aria-hidden="true" />
                </span>
                <h2 className="t-h3">{title}</h2>
            </div>
            {intro && <p className="t-body dim leading-relaxed mt-4">{intro}</p>}
            <div className="mt-4">{children}</div>
        </section>
    );
}

function AdminGuide() {
    return (
        <AdminShell title="Guide" subtitle="Connecting stores and managing accounts.">
            <div className="flex flex-col gap-14 max-w-[900px]">
                <Section
                    icon={Store}
                    title="Connecting a store"
                    intro="Trendy Treasures doesn't hold its own stock — it shows products from the stores you connect here. Nothing appears in the shop until at least one store is connected."
                >
                    <ol>
                        {CONNECT_STEPS.map((step, i) => (
                            <li
                                key={step}
                                className="grid grid-cols-[26px_1fr] gap-3.5 py-3.5 border-t border-hairlineSoft t-ui dim leading-relaxed"
                            >
                                <span
                                    className="w-[26px] h-[26px] rounded-full bg-ink text-paper grid place-items-center text-cap font-semibold shrink-0"
                                    aria-hidden="true"
                                >
                                    {i + 1}
                                </span>
                                <span>{step}</span>
                            </li>
                        ))}
                    </ol>
                </Section>

                <Section icon={Wrench} title="Keeping stores connected">
                    <dl>
                        {UPKEEP.map(({ title, body }) => (
                            <div key={title} className="py-3.5 border-t border-hairlineSoft">
                                <dt className="t-ui font-medium">{title}</dt>
                                <dd className="t-ui dim leading-relaxed mt-1">{body}</dd>
                            </div>
                        ))}
                    </dl>
                </Section>

                <Section icon={Users} title="Accounts">
                    <ul>
                        {ACCOUNTS.map((fact) => (
                            <li
                                key={fact}
                                className="py-3.5 border-t border-hairlineSoft t-ui dim leading-relaxed"
                            >
                                {fact}
                            </li>
                        ))}
                    </ul>
                </Section>
            </div>
        </AdminShell>
    );
}

export default AdminGuide;
