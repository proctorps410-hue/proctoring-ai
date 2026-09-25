import api from './api';

interface LoginResponse {
    access_token: string;
    token_type: string;
    role: string;
}

export const authService = {
    async login(email: string, password: string): Promise<boolean> {
        try {
            const formData = new FormData();
            formData.append('email', email);
            formData.append('password', password);

            const response = await api.post<LoginResponse>('auth/login/password', formData);

            if (response.data.access_token) {
                localStorage.setItem('token', response.data.access_token);
                localStorage.setItem('role', response.data.role);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Login failed:', error);
            return false;
        }
    },

    loginWithToken(token: string, role: string, userId?: string) {
        localStorage.setItem('token', token);
        localStorage.setItem('role', role);
        if (userId) localStorage.setItem('userId', userId);
        localStorage.setItem('isLti', 'true');
    },

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('userId');
        localStorage.removeItem('isLti');
    },

    isAuthenticated(): boolean {
        const token = localStorage.getItem('token');
        return !!token;
    },

    async verifyToken(): Promise<boolean> {
        try {
            const token = localStorage.getItem('token');
            if (!token) return false;

            await api.get('auth/me');
            return true;
        } catch (error) {
            this.logout();
            return false;
        }
    },

    getRole(): string | null {
        return localStorage.getItem('role');
    }
};
