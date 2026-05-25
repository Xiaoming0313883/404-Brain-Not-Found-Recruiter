export const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

export const BACKEND_FETCH_ERROR_MESSAGE = 'Failed to fetch backend server.';
