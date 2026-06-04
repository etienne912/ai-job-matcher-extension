export function createJobSignature(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\d+\s+applicants?\b/g, '')
    .replace(/\bposted\s+\d+\s+\w+\s+ago\b/g, '')
    .trim();

  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }

  return normalized ? `${normalized.length}:${hash}` : '';
}

export function isMatchingAnalysis(analysis, jobSignature) {
  return Boolean(analysis && jobSignature && analysis.jobSignature === jobSignature);
}

export function findCachedAnalysis(history, jobSignature) {
  if (!Array.isArray(history) || !jobSignature) return null;
  return history.find(entry => isMatchingAnalysis(entry, jobSignature)) || null;
}
