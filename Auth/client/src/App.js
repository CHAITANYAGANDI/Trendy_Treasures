import React from "react";
import { Route, Routes } from "react-router-dom";
import CenterToast from "./components/CenterToast";
import AuthRegistration from "./components/AuthRegistration";
import AuthLogin from "./components/AuthLogin";
import AuthDashboard from "./components/AuthDashboard";
import AuthCredentials from "./components/AuthCredentials";
import AuthCredDetails from "./components/AuthCredDetails";
import AuthSettings from "./components/AuthSettings";
import AuthForgotPassword from "./components/AuthForgotPassword";
import AuthGoogleCallback from "./components/AuthGoogleCallback";
import AuthLanding from "./components/AuthLanding";
import AuthNotFound from "./components/AuthNotFound";
import RequireAuth from "./components/RequireAuth";
import RedirectIfSignedIn from "./components/RedirectIfSignedIn";

function App() {
    return (

        <div className="App">
            <Routes>
                <Route path="/" element={<AuthLanding />} />
                {/* Sign-in, registration and reset are for guests: an
                    existing session skips them (RedirectIfSignedIn). */}
                <Route path="/auth/register" element={<RedirectIfSignedIn><AuthRegistration /></RedirectIfSignedIn>} />
                <Route path="/auth/login" element={<RedirectIfSignedIn><AuthLogin /></RedirectIfSignedIn>} />
                <Route path="/auth/dashboard" element={<RequireAuth><AuthDashboard /></RequireAuth>} />
                <Route path="/auth/credentials" element={<RequireAuth><AuthCredentials /></RequireAuth>} />
                <Route path="/auth/creds/:id" element={<RequireAuth><AuthCredDetails /></RequireAuth>} />
                <Route path="/auth/settings" element={<RequireAuth><AuthSettings /></RequireAuth>} />
                <Route path="/auth/forgot-password" element={<RedirectIfSignedIn><AuthForgotPassword /></RedirectIfSignedIn>} />
                <Route path="/auth/google/callback" element={<AuthGoogleCallback />} />
                {/* Anything no route above claims — ranked last, so it never
                    shadows a real page. */}
                <Route path="*" element={<AuthNotFound />} />
            </Routes>
            <CenterToast />
        </div>

    );
}

export default App;
