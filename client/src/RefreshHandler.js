import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchCurrentUser } from './utils';


function RefreshHandler({ setIsAuthenticated }) {

    const location = useLocation();
    const navigate = useNavigate();


    useEffect(() => {
        // Admin routes have their own session owner (RequireAdmin →
        // fetchCurrentAdmin). Probing the *shopper* session here as well
        // added a second, useless round trip on every admin navigation, and
        // it can never authenticate an admin anyway. Nothing below this
        // applies to /admin/*: the redirect targets are shopper pages.
        if (location.pathname.startsWith('/admin')) return undefined;

        let cancelled = false;
        fetchCurrentUser().then((user) => {
            if (cancelled) return;
            if (user) {
                setIsAuthenticated && setIsAuthenticated(true);
                if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/signup') {
                    navigate('/home', { replace: false });
                }
            } else {
                setIsAuthenticated && setIsAuthenticated(false);
            }
        });
        return () => { cancelled = true; };
    }, [location, navigate, setIsAuthenticated]);

    return null;
}

export default RefreshHandler;
