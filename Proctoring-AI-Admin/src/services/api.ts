import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1/';

const api = axios.create({
    baseURL: API_URL,
    headers: {
    },
});

// Add a request interceptor to attach the Token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor - auto logout on 401 (expired/invalid token)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        console.error('API Error:', error.response?.status, error.response?.data);
        if (error.response?.status === 401) {
            // Clear stale token and reload to show login screen
            localStorage.removeItem('token');
            localStorage.removeItem('role');
            localStorage.removeItem('userId');
            window.location.reload();
        }
        return Promise.reject(error);
    }
);

export default api;
