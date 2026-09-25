import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';

export const store = configureStore({
    reducer: {
        auth: authReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
        }),
});

// Initialize auth state from localStorage
const token = localStorage.getItem('token');
const userId = localStorage.getItem('userId');

if (token && userId) {
    store.dispatch({
        type: 'auth/setCredentials',
        payload: { token, userId }
    });
}
