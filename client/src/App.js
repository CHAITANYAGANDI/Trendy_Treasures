import React, { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Signin from "./components/Signin";
import Signup from "./components/Signup";
import Home from "./components/Home";
import RefreshHandler from './RefreshHandler';
import GoogleCallback from './components/GoogleCallBack';
import ForgotPassword from './components/ForgotPassword';
import VerifyOtp from './components/VerifyOtp';
import ResetPassword from './components/ResetPassword';
import VerifySignupOtp from './components/VerifySignupOtp';
import AdminLogin from "./components/AdminLogin";
import AuthManagement from "./components/AuthManagement";
import AdminGuide from "./components/AdminGuide";
import ClientCallBack from "./components/ClientCallBack";
import ProductDetails from "./components/ProductDetails";
import Cart from './components/Cart';
import MyAlerts from './components/MyAlerts';
import UserManagement from './components/UserManagement';
import RequireAdmin from './components/RequireAdmin';
import CenterToast from './components/CenterToast';
import ConfirmModal from './components/ConfirmModal';


function App() {

    const [, setIsAuthenticated] = useState(false);

    return (

        <div className="App">

            <RefreshHandler setIsAuthenticated={setIsAuthenticated} />
            <CenterToast />
            <ConfirmModal />
            <Routes>
                <Route path="/" element={<Navigate to="/home" />} />
                <Route path="/login" element={<Signin />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/product/:source/:productId" element={<ProductDetails />} />
                <Route path="/home" element={<Home />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/alerts" element={<MyAlerts />} />

                <Route path="/auth/google/callback" element={<GoogleCallback />} />
                <Route path="/verify-signup" element={<VerifySignupOtp />} />
                <Route path="/forgotpassword" element={<ForgotPassword />} />
                <Route path="/verifyotp" element={<VerifyOtp />} />
                <Route path="/resetpassword" element={<ResetPassword />} />


                <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
                <Route path="/admin/login" element={<AdminLogin />} />

                {/* Admin recovery reuses the storefront screens in their dark
                    appearance and hits the same /recovery/* endpoints — those
                    look accounts up by email with no role filter, and admins
                    live in the same collection. */}
                <Route path="/admin/forgot" element={<ForgotPassword admin />} />
                <Route path="/admin/verifyotp" element={<VerifyOtp admin />} />
                <Route path="/admin/resetpassword" element={<ResetPassword admin />} />
                <Route path="/admin/users" element={<RequireAdmin><UserManagement /></RequireAdmin>} />
                <Route path="/admin/auth" element={<RequireAdmin><AuthManagement /></RequireAdmin>} />
                <Route path="/admin/guide" element={<RequireAdmin><AdminGuide /></RequireAdmin>} />

                {/* The dashboard is gone, adding an admin is a dialog on the
                    user list, and the authorized APIs are a section of auth
                    management. The old URLs still resolve so existing links
                    and bookmarks land somewhere sensible. */}
                <Route path="/admin/dashboard" element={<Navigate to="/admin/users" replace />} />
                <Route path="/admin/register" element={<Navigate to="/admin/users" replace />} />
                <Route path="/admin/auth/protected" element={<Navigate to="/admin/auth" replace />} />
                <Route path="/admin/auth/request" element={<Navigate to="/admin/auth" replace />} />
                <Route path="/admin/client/callback" element={<RequireAdmin><ClientCallBack /></RequireAdmin>} />
            </Routes>

        </div>
    );
}

export default App;
