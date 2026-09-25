const API_URL = import.meta.env.VITE_API_URL;
const BASE_URL = `${API_URL}/api/v1/exam`;
const WS_URL = import.meta.env.VITE_WS_URL;
import { authService } from './authService';
import { toTimestampMs } from '../utils/timeUtils';
const retryFetch = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;

            const error = await response.json().catch(() => ({}));
            if (response.status === 500) {
                console.log(`Attempt ${i + 1}: Retrying due to server error...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                continue;
            }
            throw new Error(error.message || `HTTP error! status: ${response.status}`);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
};

const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    if (!token) {
        const err = new Error('Authentication required');
        err.code = 'AUTH_EXPIRED';
        throw err;
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.trim()}`
    };
};

const sendRequest = async (url, options) => {
    const defaultOptions = {
        headers: getAuthHeaders(),
        mode: 'cors'
    };

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `Request failed: ${response.status}`);
    }

    return response.json().catch(() => ({}));
};

const forceCloseExam = async (userId) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/exam/force-close/${userId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });

    if (!response.ok) {
        throw new Error('Failed to force close exam');
    }
    return response.json();
};

const parseJoinability = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return Boolean(value);
};

const examStatusPriority = {
    active: 0,
    upcoming: 1,
    ended: 2,
};

const sortAvailableExams = (exams) => [...exams].sort((a, b) => {
    if (a.canJoin !== b.canJoin) {
        return a.canJoin ? -1 : 1;
    }

    const aStatus = examStatusPriority[a.status] ?? 99;
    const bStatus = examStatusPriority[b.status] ?? 99;
    if (aStatus !== bStatus) {
        return aStatus - bStatus;
    }

    const aStart = toTimestampMs(a.start_time);
    const bStart = toTimestampMs(b.start_time);
    return aStart - bStart;
});

export const examService = {
    async warmupProctoring() {
        try {
            const response = await fetch(`${BASE_URL}/warmup`, {
                method: 'POST',
                headers: getAuthHeaders(),
            });
            return await response.json().catch(() => ({}));
        } catch (error) {
            console.debug('Warmup request failed:', error);
            return { ready: false, error: 'warmup_failed' };
        }
    },

    async getAvailableExams() {
        try {
            const response = await sendRequest(`${BASE_URL}/available`);
            if (!Array.isArray(response)) {
                return [];
            }

            const normalized = response.map((exam) => ({
                ...exam,
                canJoin: parseJoinability(exam.can_join ?? exam.canJoin),
                questionCount: exam.question_count ?? 0,
                lastSessionStatus: exam.last_session_status ?? null,
                actionMessage: exam.action_message ?? '',
            }));

            return sortAvailableExams(normalized);
        } catch (error) {
            console.error('Get available exams error:', error);
            throw error;
        }
    },

    async getSession(userId) {
        try {
            const response = await fetch(`${BASE_URL}/session/${userId}`, {
                headers: getAuthHeaders()
            });
            if (!response.ok) throw new Error('Failed to get session');
            return await response.json();
        } catch (error) {
            console.error('Get session error:', error);
            throw error;
        }
    },

    async getExamDetails(examId) {
        try {
            const response = await fetch(`${BASE_URL}/${examId}`, {
                headers: getAuthHeaders()
            });
            if (!response.ok) throw new Error('Failed to get exam details');
            return await response.json();
        } catch (error) {
            console.error('Get exam details error:', error);
            throw error;
        }
    },

    async startExam(userId, examId = null) {
        try {
            const url = examId ? `${BASE_URL}/start/${userId}?exam_id=${examId}` : `${BASE_URL}/start/${userId}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: getAuthHeaders()
            });

            const data = await response.json();
            if (!response.ok) {
                const errorMessage = data.detail || 'Failed to start exam';
                throw new Error(`${errorMessage} (${response.status})`);
            }

            // Simplify WebSocket URL construction
            if (data.wsUrl) {
                data.wsUrl = `${WS_URL}/${userId}`;
            }

            return data;
        } catch (error) {
            console.error('Start exam error:', error);
            throw error;
        }
    },

    async pauseExam(userId) {
        try {
            const token = localStorage.getItem('token');
            const formData = new FormData();
            formData.append('userId', userId);

            const response = await retryFetch(`${BASE_URL}/pause/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token.trim()}`
                },
                body: formData
            });
            return await response.json();
        } catch (error) {
            console.error('Pause exam error:', error);
            throw new Error('Failed to pause exam. Please try again.');
        }
    },

    async resumeExam(userId) {
        try {
            const token = localStorage.getItem('token');
            const formData = new FormData();
            formData.append('userId', userId);

            const response = await retryFetch(`${BASE_URL}/resume/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token.trim()}`
                },
                body: formData
            });
            return await response.json();
        } catch (error) {
            console.error('Resume exam error:', error);
            throw new Error('Failed to resume exam. Please try again.');
        }
    },

    async stopExam(userId) {
        try {
            // Send stop request to server
            const response = await sendRequest(`${BASE_URL}/stop/${userId}`, {
                method: 'POST'
            });
            return response;
        } catch (error) {
            console.error('Stop exam error:', error);
            throw error;
        }
    },

    // Remove endExam method since we're not using it anymore

    async endExamAndLogout(userId) {
        try {
            await this.stopExam(userId);
            authService.logout();
            return { success: true, message: 'Exam ended and logged out successfully' };
        } catch (error) {
            console.error('End exam and logout error:', error);
            throw error;
        }
    },

    async getExamSummary(userId) {
        try {
            const response = await sendRequest(`${BASE_URL}/summary/${userId}`);
            return response;
        } catch (error) {
            console.error('Get summary error:', error);
            throw error;
        }
    },

    async clearLogs(userId) {
        try {
            const response = await fetch(`${BASE_URL}/clear-logs/${userId}`, {
                method: 'POST',
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to clear logs');
            }

            return true;
        } catch (error) {
            console.warn('Clear logs error:', error);
            // Don't throw error since this is cleanup
            return false;
        }
    },

    async saveProgress(userId, progressData) {
        try {
            const response = await fetch(`${BASE_URL}/progress/${userId}`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(progressData),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to save exam progress');
            }

            return data;
        } catch (error) {
            console.error('Save exam progress error:', error);
            throw error;
        }
    },

    async submitExam(userId, submissionData) {
        try {
            const response = await fetch(`${BASE_URL}/submit/${userId}`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(submissionData)
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to submit exam');
            }
            return data;
        } catch (error) {
            console.error('Submit exam error:', error);
            throw error;
        }
    },

    async logViolation(type, message, data = {}) {
        try {
            await fetch(`${BASE_URL}/log`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    log: message,
                    event_type: type,
                    event_data: data
                })
            });
        } catch (error) {
            console.error('Log violation error:', error);
            // Don't throw, just log error, as we don't want to interrupt the exam flow for logging failure
        }
    },

    forceCloseExam,
};
