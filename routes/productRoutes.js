const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { upload } = require('../utils/s3Uploader');
const { verifyTokenforactions } = require('../utils/authMiddleware');
const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS,
    secretAccessKey: process.env.AWS_SECRET
  }
});


router.post(
  '/add',
  upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'gallery_images', maxCount: 4 },
    { name: 'product_video', maxCount: 1 },
    { name: 'product_reel', maxCount: 1 }
  ]),
  verifyTokenforactions, productController.addProduct
);
router.get('/get' ,productController.getProducts);
router.get('/getbyslug/:slug' ,productController.getProductsbySlug);
router.delete('/delete/:product_id',verifyTokenforactions  ,productController.deleteProduct);
router.put(
  '/update/:product_id',
  upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'gallery_images', maxCount: 4 },
    { name: 'product_video', maxCount: 1 },
    { name: 'product_reel', maxCount: 1 }
  ]),verifyTokenforactions, 
  productController.updateProduct
);

router.put(
  '/updatestatus/:product_id',verifyTokenforactions, 
  productController.updateProductStatus
);

module.exports = router;
