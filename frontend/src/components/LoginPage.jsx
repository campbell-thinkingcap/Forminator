import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';

export default function LoginPage({ onLogin }) {
  const handleSuccess = (credentialResponse) => {
    const decoded = jwtDecode(credentialResponse.credential);
    onLogin({
      name: decoded.name,
      email: decoded.email,
      picture: decoded.picture,
    });
  };

  return (
    <div className="login-page">
      <div className="login-card card fade-in">
        <h1>Forminator</h1>
        <p className="subtitle">Dynamic Form Generator based on JSON Schema</p>
        <div className="login-divider" />
        <p className="login-prompt">Sign in to continue</p>
        <div className="login-google-btn">
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => console.error('Google login failed')}
            theme="filled_black"
            shape="rectangular"
            size="large"
            text="signin_with"
          />
        </div>
      </div>
    </div>
  );
}
