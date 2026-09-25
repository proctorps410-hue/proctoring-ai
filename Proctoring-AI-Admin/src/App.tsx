import React, { useState } from 'react';
import { AdminLoginPage } from './components/AdminLoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { authService } from './services/authService';
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  React.useEffect(() => {
    // Check for LTI Token in URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      const userId = params.get('userId');
      authService.loginWithToken(token, 'admin', userId || undefined);
      setIsLoggedIn(true);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (authService.isAuthenticated()) {
      // Validate session with backend
      authService.verifyToken().then((isValid) => {
        setIsLoggedIn(isValid);
      });
    }
  }, []);

  const handleLogin = async (email: string, password: string) => {
    const success = await authService.login(email, password);
    if (success) {
      setIsLoggedIn(true);
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    authService.logout();
    setIsLoggedIn(false);
  };

  return (
    <>
      {!isLoggedIn ? (
        <AdminLoginPage onLogin={handleLogin} />
      ) : (
        <AdminDashboard onLogout={handleLogout} />
      )}
    </>
  );
}
