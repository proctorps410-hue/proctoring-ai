const LOBBY_PROGRESS_PREFIX = 'examLobby:';
const DASHBOARD_ENTRY_KEY = `${LOBBY_PROGRESS_PREFIX}selectedExamId`;

const emptyProgress = {
    systemChecks: {},
    networkChecks: {},
};

const parseProgress = (value) => {
    if (!value) {
        return { ...emptyProgress };
    }

    try {
        const parsed = JSON.parse(value);
        return {
            systemChecks: parsed?.systemChecks || {},
            networkChecks: parsed?.networkChecks || {},
        };
    } catch {
        return { ...emptyProgress };
    }
};

export const getLobbyProgressKey = (examId) => `${LOBBY_PROGRESS_PREFIX}${examId}`;

export const getLobbyProgress = (examId) => {
    if (!examId) {
        return { ...emptyProgress };
    }

    return parseProgress(sessionStorage.getItem(getLobbyProgressKey(examId)));
};

export const updateLobbyProgress = (examId, partialProgress) => {
    if (!examId) {
        return { ...emptyProgress };
    }

    const currentProgress = getLobbyProgress(examId);
    const nextProgress = {
        systemChecks: {
            ...currentProgress.systemChecks,
            ...(partialProgress?.systemChecks || {}),
        },
        networkChecks: {
            ...currentProgress.networkChecks,
            ...(partialProgress?.networkChecks || {}),
        },
    };

    sessionStorage.setItem(getLobbyProgressKey(examId), JSON.stringify(nextProgress));
    return nextProgress;
};

export const clearLobbyProgress = (examId) => {
    if (!examId) {
        return;
    }

    sessionStorage.removeItem(getLobbyProgressKey(examId));
};

export const clearAllLobbyProgress = () => {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(LOBBY_PROGRESS_PREFIX)) {
            sessionStorage.removeItem(key);
        }
    }
};

export const rememberDashboardExamEntry = (examId) => {
    if (!examId) {
        return;
    }

    sessionStorage.setItem(DASHBOARD_ENTRY_KEY, String(examId));
};

export const getRememberedDashboardExamEntry = () => (
    sessionStorage.getItem(DASHBOARD_ENTRY_KEY)
);

export const hasCompletedSystemChecks = (progress) => Boolean(
    progress?.systemChecks?.browserDownloaded
    && progress?.systemChecks?.browserOpened
    && progress?.systemChecks?.cameraAllowed
    && progress?.systemChecks?.microphoneAllowed
);

export const hasCompletedNetworkChecks = (progress) => Boolean(
    hasCompletedSystemChecks(progress)
    && progress?.networkChecks?.screenSharingAllowed
    && progress?.networkChecks?.networkTestComplete
);
