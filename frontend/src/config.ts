/**
 * Dynamically computes the backend API Base URL based on the current origin.
 * - Local dev: http://localhost:3001
 * - Google Cloud Run: https://scandoc-backend-[project-num].[region].run.app
 * - Custom domain / Load Balancer: relative paths (empty string)
 */
export const getApiBaseUrl = (): string => {
  const origin = window.location.origin;
  
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return 'http://localhost:3001';
  }
  
  if (origin.includes('scandoc-frontend')) {
    return origin.replace('scandoc-frontend', 'scandoc-backend');
  }
  
  // Return empty string for relative routing if mapped behind a unified load balancer domain
  return '';
};
