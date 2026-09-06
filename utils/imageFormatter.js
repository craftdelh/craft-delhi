/**
 * Helper to ensure image fields in API responses always return 
 * structured 3-size objects: { icon, thumbnail, full }.
 */

const formatImageSizes = (img) => {
  if (!img) return null;
  if (typeof img === 'object' && !Array.isArray(img)) return img;
  if (typeof img === 'string') {
    const trimmed = img.trim();
    if (trimmed === '[object Object]') return null;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {}
    }
    if (trimmed.startsWith('http')) {
      return { icon: trimmed, thumbnail: trimmed, full: trimmed };
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

module.exports = { formatImageSizes, formatGalleryImages };
