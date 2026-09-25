import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './store/store';
import Login from './components/Login';
import Signup from './components/Signup';
import Exam from './components/Exam';
import ExamLobbyHome from './components/ExamLobbyHome';
import { SystemCheckPage } from './app/components/SystemCheckPage';
import { NetworkCheckPage } from './app/components/NetworkCheckPage';
import Summary from './components/Summary';
import LTICallback from './components/LTICallback';
import VerifyIdentity from './components/VerifyIdentity';

const isAuthenticatedUser = () => {
    const token = localStorage.getItem('token')?.trim();
    const userId = localStorage.getItem('userId')?.trim();

    return Boolean(
        token &&
        userId &&
        token !== 'undefined' &&
        token !== 'null' &&
        userId !== 'undefined' &&
        userId !== 'null'
    );
};

const ltiIdentityPending = () => localStorage.getItem('ltiIdentityPending') === '1';

// eslint-disable-next-line react/prop-types
const ProtectedRoute = ({ children }) => {
    const location = useLocation();
    const [isAuthenticated, setIsAuthenticated] = React.useState(null);

    React.useEffect(() => {
        const checkAuth = () => {
            const token = localStorage.getItem('token')?.trim();
            const userId = localStorage.getItem('userId')?.trim();
            
            const isValid = Boolean(
                token && 
                userId && 
                token !== 'undefined' && 
                token !== 'null' &&
                userId !== 'undefined' &&
                userId !== 'null'
            );
            
            console.log('[AuthCheck]', { isValid, token: !!token, userId: !!userId });
            setIsAuthenticated(isValid);
        };

        checkAuth();
        // Add event listener for storage changes
        window.addEventListener('storage', checkAuth);
        return () => window.removeEventListener('storage', checkAuth);
    }, []);

    // Show loading or nothing while checking auth
    if (isAuthenticated === null) return null;

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (ltiIdentityPending() && location.pathname !== '/verify-identity') {
        return <Navigate to="/verify-identity" replace />;
    }

    return children;
};

// eslint-disable-next-line react/prop-types
const AuthLandingRoute = ({ children }) => {
    if (isAuthenticatedUser() && ltiIdentityPending()) {
        return <Navigate to="/verify-identity" replace />;
    }
    if (isAuthenticatedUser()) {
        return <Navigate to="/exam" replace />;
    }

    return children;
};

const App = () => {
    return (
        <Provider store={store}>
            <BrowserRouter>
                <Routes>
                    <Route path="/lti/callback" element={<LTICallback />} />
                    <Route path="/verify-identity" element={
                        <ProtectedRoute>
                            <VerifyIdentity />
                        </ProtectedRoute>
                    } />
                    <Route path="/login" element={
                        <AuthLandingRoute>
                            <Login />
                        </AuthLandingRoute>
                    } />
                    <Route path="/signup" element={
                        <AuthLandingRoute>
                            <Signup />
                        </AuthLandingRoute>
                    } />
                    <Route path="/exam/:examId" element={
                        <ProtectedRoute>
                            <SystemCheckPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/exam/:examId/network-check" element={
                        <ProtectedRoute>
                            <NetworkCheckPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/exam/:examId/active" element={
                        <ProtectedRoute>
                            < Exam />
                        </ProtectedRoute>
                    } />
                    <Route path="/exam" element={
                        <ProtectedRoute>
                            <ExamLobbyHome />
                        </ProtectedRoute>
                    } />
                    <Route path="/exam/network-check" element={
                        <ProtectedRoute>
                            <Navigate to="/exam" replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/exam/active" element={
                        <ProtectedRoute>
                            < Exam />
                        </ProtectedRoute>
                    } />
                    <Route path="/summary" element={
                        <ProtectedRoute>
                            <Summary />
                        </ProtectedRoute>
                    } />
                    <Route
                        path="/"
                        element={
                            isAuthenticatedUser() && ltiIdentityPending()
                                ? <Navigate to="/verify-identity" replace />
                                : <Navigate to={isAuthenticatedUser() ? "/exam" : "/login"} replace />
                        }
                    />
                </Routes>
            </BrowserRouter>
        </Provider>
    );
};

export default App;
