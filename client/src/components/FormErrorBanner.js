import React from 'react';
import { AlertCircle } from 'lucide-react';

function FormErrorBanner({ message }) {
    if (!message) return null;

    return (
        <div className="errbanner" role="alert">
            <AlertCircle size={17} aria-hidden="true" />
            <span>{message}</span>
        </div>
    );
}

export default FormErrorBanner;
