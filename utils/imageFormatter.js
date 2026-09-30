require('dotenv').config();

/**
 * Convert a relative S3 key or existing URL into a full S3 URL string.
 */
const getFullUrl = (input) => {
  if (!input) return null;
  if (typeof input === 'object') {
    return getFullUrl(input.full || input.thumbnail || input.icon);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed === '[object Object]') return null;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return getFullUrl(parsed);
    } catch (e) {}
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return trimmed;
  const baseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
  const cleanKey = trimmed.replace(/^\/+/, '');
  return `${baseUrl}/${cleanKey}`;
};

/**
 * Helper to ensure image fields in API responses always return 
 * structured 3-size objects: { icon, thumbnail, full }.
 */
const formatImageSizes = (img) => {
  if (!img) return null;

  let parsed = img;
  if (typeof img === 'string') {
    const trimmed = img.trim();
    if (trimmed === '[object Object]') return null;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {}
    }
  }

  // If parsed object has icon/thumbnail/full keys
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const iconVal = parsed.icon || parsed.full || parsed.thumbnail;
    const thumbVal = parsed.thumbnail || parsed.full || parsed.icon;
    const fullVal = parsed.full || parsed.thumbnail || parsed.icon;

    if (!iconVal && !thumbVal && !fullVal) return null;

    return {
      icon: getFullUrl(iconVal),
      thumbnail: getFullUrl(thumbVal),
      full: getFullUrl(fullVal)
    };
  }

  // If parsed is a plain string key or URL
  if (typeof parsed === 'string') {
    const fullUrl = getFullUrl(parsed);
    if (fullUrl) {
      return { icon: fullUrl, thumbnail: fullUrl, full: fullUrl };
    }
  }

  return null;
};

const formatGalleryImages = (gallery) => {
  if (!gallery) return [];
  let list = gallery;
  if (typeof gallery === 'string') {
    try {
      list = JSON.parse(gallery);
    } catch (e) {
      return [];
    }
  }
  if (Array.isArray(list)) {
    return list.map(item => formatImageSizes(item)).filter(Boolean);
  }
  return [];
};

module.exports = { getFullUrl, formatImageSizes, formatGalleryImages };
