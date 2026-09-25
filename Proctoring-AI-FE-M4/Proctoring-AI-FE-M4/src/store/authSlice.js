import { createSlice } from '@reduxjs/toolkit';

const validateAuth = () => {
    const token = localStorage.getItem('token')?.trim();
    const userId = localStorage.getItem('userId');
    const isValid = Boolean(token && userId && token !== 'undefined' && token !== 'null');
    return { isValid, token, userId };
};

const { isValid, token, userId } = validateAuth();

const initialState = {
    token: token || null,
    userId: userId || null,
    isAuthenticated: isValid,
    initialized: isValid
};

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setCredentials: (state, action) => {
            const { token, userId } = action.payload;
            if (!token || !userId) return;
            
            state.token = token;
            state.userId = userId;
            state.isAuthenticated = true;
            state.initialized = true;

            localStorage.setItem('token', token);
            localStorage.setItem('userId', userId);
        },
        logout: (state) => {
            state.token = null;
            state.userId = null;
            state.isAuthenticated = false;
            state.initialized = false;
            localStorage.removeItem('token');
            localStorage.removeItem('userId');
        }
    }
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
