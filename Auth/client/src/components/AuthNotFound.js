import React from 'react';
import { Link } from 'react-router-dom';

const ACCENT = '#426fe7';

// Any address no route claims, drawn like the sign-in card.
function AuthNotFound() {
    return (
        <div className="font-body antialiased min-h-screen w-full flex items-center justify-center bg-[#f8f9ff] text-[#0b1c30] p-6">
            <div className="w-full max-w-md">
                <Link to="/" className="flex items-center gap-3 mb-8 justify-center no-underline" aria-label="AuthShield home">
                    <span className="material-symbols-outlined fill text-5xl" style={{ color: ACCENT }} aria-hidden="true">
                        shield
                    </span>
                    <span className="font-headline font-bold text-4xl tracking-tight text-[#0b1c30]">
                        AuthShield
                    </span>
                </Link>

                <div
                    className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#e5eeff] border-b-2 p-8 sm:p-10 text-center"
                    style={{ borderBottomColor: ACCENT }}
                >
                    <span className="material-symbols-outlined text-5xl text-[#5f5e5e]" aria-hidden="true">
                        travel_explore
                    </span>
                    <h1 className="font-headline font-bold text-3xl text-[#0b1c30] mt-3 mb-2">
                        Page not found
                    </h1>
                    <p className="font-body text-sm text-[#5f5e5e]">
                        There's no page at this address. It may have moved, or the link may be mistyped.
                    </p>

                    <Link
                        to="/"
                        className="mt-8 w-full flex justify-center items-center py-3 px-4 rounded shadow-sm text-lg font-headline font-semibold no-underline transition-colors"
                        style={{ backgroundColor: ACCENT, color: '#ffffff' }}
                    >
                        Back to AuthShield
                        <span className="material-symbols-outlined ml-2 text-lg" aria-hidden="true">
                            arrow_forward
                        </span>
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default AuthNotFound;
