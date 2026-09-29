'use strict';

// Signed download URLs are evidence inputs, not public tracker links. Keep the
// source records intact for reproducibility, but omit bearer credentials from
// every string crossing into the self-contained public HTML payload.
const CREDENTIAL_PARAM = /(?:^|[?&;])(?:sig|signature|x-amz-signature|x-goog-signature|token|access_token|api_key|apikey|key|secret|sas)=/i;
const URL = /https?:\/\/[^\s<>"'`]+/gi;

function isCredentialUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try { return CREDENTIAL_PARAM.test(new URLConstructor(value).search); }
  catch { return CREDENTIAL_PARAM.test(value); }
}

const URLConstructor = globalThis.URL;

function protectString(value) {
  if (isCredentialUrl(value)) return '';
  return value.replace(URL, match => {
    const trailing = match.match(/[),.;]+$/)?.[0] || '';
    const candidate = trailing ? match.slice(0, -trailing.length) : match;
    return isCredentialUrl(candidate) ? '[signed URL withheld]' + trailing : match;
  });
}

function protectPublicUrls(value) {
  if (typeof value === 'string') return protectString(value);
  if (Array.isArray(value)) return value.map(protectPublicUrls);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, protectPublicUrls(item)]));
  return value;
}

module.exports = { isCredentialUrl, protectPublicUrls };
