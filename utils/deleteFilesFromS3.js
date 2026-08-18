const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.AWS_REGION, // e.g., 'ap-south-1'
  credentials: {
    accessKeyId: process.env.AWS_ACCESS,
    secretAccessKey: process.env.AWS_SECRET
  }
});

/**
 * Extract S3 key from full URL.
 */
const getS3KeyFromUrl = (input) => {
  try {
    if (input.startsWith('http')) {
      const urlObj = new URL(input);
      return decodeURIComponent(urlObj.pathname).replace(/^\/+/, '');
    }
    // Already a key, return as-is
    return input;
  } catch (err) {
    console.error('Invalid S3 URL:', input);
    return null;
  }
};

const extractKeys = (input) => {
  if (!input) return [];
  if (typeof input === 'object') {
    return Object.values(input).map(getS3KeyFromUrl).filter(Boolean);
  }
  if (typeof input === 'string') {
    if (input.startsWith('{') && input.endsWith('}')) {
      try {
        const parsed = JSON.parse(input);
        return Object.values(parsed).map(getS3KeyFromUrl).filter(Boolean);
      } catch (e) {}
    }
    const key = getS3KeyFromUrl(input);
    return key ? [key] : [];
  }
  return [];
};

/**
 * Delete multiple files from S3 given an array of file URLs or objects.
 * @param {Array} urls
 * @param {string} bucketName
 */
const deleteFilesFromS3 = async (urls = [], bucketName) => {
  const keys = [];
  const inputList = Array.isArray(urls) ? urls : [urls];
  
  inputList.forEach(item => {
    keys.push(...extractKeys(item));
  });

  const objectsToDelete = [...new Set(keys)].map(key => ({ Key: key }));

  if (!objectsToDelete.length) return { deleted: [], skipped: true };

  const command = new DeleteObjectsCommand({
    Bucket: bucketName,
    Delete: { Objects: objectsToDelete }
  });

  try {
    const result = await s3.send(command);
    return {
      deleted: (result.Deleted || []).map(obj => obj.Key),
      skipped: false
    };
  } catch (err) {
    console.error('S3 deletion error:', err);
    throw err;
  }
};

module.exports = { deleteFilesFromS3, getS3KeyFromUrl };
