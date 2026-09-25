import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2/dist/sweetalert2.js';

const LTICallback = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    useEffect(() => {
        const processLogin = async () => {
            const token = searchParams.get('token');
            const role = searchParams.get('role'); // 'admin' or 'student'
            const userId = searchParams.get('userId');

            if (!token) {
                Swal.fire({
                    icon: 'error',
                    title: 'Authentication Failed',
                    text: 'No token received from LMS.',
                    background: '#2a2a2a',
                    color: '#fff'
                });
                navigate('/login');
                return;
            }

            try {
                // Store authentication data
                localStorage.setItem('token', token);
                if (userId) localStorage.setItem('userId', userId);
                localStorage.setItem('isLti', 'true');

                if (role === 'admin') {
                    const adminBaseUrl = (import.meta.env.VITE_ADMIN_URL || window.location.origin).replace(/\/+$/, '');
                    const params = new URLSearchParams({ token });
                    if (userId) params.set('userId', userId);
                    window.location.href = `${adminBaseUrl}/?${params.toString()}`;
                } else {
                    // LTI students: face bind before exam (native / Excel-upload students use /login only)
                    localStorage.setItem('ltiIdentityPending', '1');
                    navigate('/verify-identity', { replace: true });
                }

            } catch (error) {
                console.error('LTI Callback Error:', error);
                navigate('/login');
            }
        };

        processLogin();
    }, [navigate, searchParams]);

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            background: '#1a1a1a',
            color: 'white',
            flexDirection: 'column',
            gap: '20px'
        }}>
            <div className="loader"></div>
            <h2>Authenticating with University LMS...</h2>
            <p>Please wait while we log you in.</p>
            <style>{`
                .loader {
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #646cff;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default LTICallback;
