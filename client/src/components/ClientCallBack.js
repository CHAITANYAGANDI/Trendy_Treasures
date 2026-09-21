import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils';
import BrandMark from './BrandMark';
import { Spinner } from './ui/Primitives';

function ClientCallBack() {
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchClient() {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const clientId = urlParams.get('client_id');
        const redirectUri = urlParams.get('redirectUri');
        const username = urlParams.get('username');

        const requestBody = { clientId, redirectUri, username };

        const response = await apiFetch('/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) navigate('/admin/auth');
        else console.error('Failed to authenticate');
      } catch (error) {
        console.error('Error handling callback:', error);
      }
    }
    fetchClient();
  }, [navigate]);

  return (
    <div className="authpage justify-center">
      <div className="authcol text-center">
        <BrandMark className="w-8 h-8 mx-auto" />
        <div className="flex justify-center mt-8">
          <Spinner />
        </div>
        <h1 className="t-h2 mt-6">Finalizing authorization…</h1>
        <p className="t-body dim mt-2.5">
          Storing the access token and taking you back to Auth management.
        </p>
      </div>
    </div>
  );
}

export default ClientCallBack;
