const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS,
    secretAccessKey: process.env.AWS_SECRET
  }
});

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, true)
});

// Map fieldname to S3 folder and short prefix
const fieldMap = {
  main_image: { folder: 'main_image', prefix: 'mi' },
  gallery_images: { folder: 'gallery_images', prefix: 'gi' },
  product_video: { folder: 'product_video', prefix: 'vd' },
  product_reel: { folder: 'product_reel', prefix: 'rl' },
  store_image: { folder: 'store_image', prefix: 'si' },
  profile_image: { folder: 'profile_image', prefix: 'pi' },
  banner: { folder: 'banner', prefix: 'ba' },
  gift_image: { folder: 'gift_image', prefix: 'gi' },
  category_image: { folder: 'category_image', prefix: 'ci' }
};

// Custom upload handler
const uploadToS3 = async (file, fieldname) => {
  const { folder, prefix } = fieldMap[fieldname] || { folder: 'others', prefix: 'ot' };
  const timestamp = Date.now();
  const ext = path.extname(file.originalname) || '.jpg';
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  const baseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;

  // Check if file is an image
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    const isPng = file.mimetype === 'image/png';
    const outputExt = isPng ? '.png' : '.jpg';
    const contentType = isPng ? 'image/png' : 'image/jpeg';

    const [iconBuffer, thumbBuffer, fullBuffer] = await Promise.all([
      sharp(file.buffer)
        .resize(150, 150, { fit: 'cover' })
        .toFormat(isPng ? 'png' : 'jpeg', { quality: 80 })
        .toBuffer(),
      sharp(file.buffer)
        .resize(400, 400, { fit: 'cover' })
        .toFormat(isPng ? 'png' : 'jpeg', { quality: 85 })
        .toBuffer(),
      sharp(file.buffer)
        .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
        .toFormat(isPng ? 'png' : 'jpeg', { quality: 90 })
        .toBuffer()
    ]);

    const iconKey = `${folder}/${prefix}-${timestamp}-icon${outputExt}`;
    const thumbKey = `${folder}/${prefix}-${timestamp}-thumb${outputExt}`;
    const fullKey = `${folder}/${prefix}-${timestamp}-full${outputExt}`;

    await Promise.all([
      s3.send(new PutObjectCommand({ Bucket: bucket, Key: iconKey, Body: iconBuffer, ContentType: contentType })),
      s3.send(new PutObjectCommand({ Bucket: bucket, Key: thumbKey, Body: thumbBuffer, ContentType: contentType })),
      s3.send(new PutObjectCommand({ Bucket: bucket, Key: fullKey, Body: fullBuffer, ContentType: contentType }))
    ]);

    return {
      icon: `${baseUrl}/${iconKey}`,
      thumbnail: `${baseUrl}/${thumbKey}`,
      full: `${baseUrl}/${fullKey}`
    };
  }

  // Non-image upload (videos, reels, documents)
  const filename = `${prefix}-${timestamp}${ext}`;
  const key = `${folder}/${filename}`;

  const params = {
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype
  };

  await s3.send(new PutObjectCommand(params));
  return `${baseUrl}/${key}`;
};

const getS3KeyFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  const prefix = `https://${bucket}.s3.${region}.amazonaws.com/`;
  return url.startsWith(prefix) ? url.replace(prefix, '') : null;
};

module.exports = { upload, uploadToS3, fieldMap, getS3KeyFromUrl };
