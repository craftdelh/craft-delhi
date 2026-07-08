const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminDetailsController');
const { verifyTokenforactions } = require('../utils/authMiddleware');
const { upload } = require('../utils/s3Uploader');
const productController = require('../controllers/productController');

router.get('/dashboard-stats', verifyTokenforactions,  adminController.getDashboardStats);
router.get('/total-users', verifyTokenforactions,  adminController.getTotalusers);

router.get('/products-view', verifyTokenforactions, adminController.adminProductsView);
router.put('/update-product-approval/:product_id', verifyTokenforactions, adminController.updateApprovalStatus);
router.get('/products-stats', verifyTokenforactions,  adminController.getProductsStats);
router.get('/totalproductsforadmin', verifyTokenforactions,  adminController.getTotalProducts);
router.delete('/deleteproductbyadmin/:product_id', verifyTokenforactions,  productController.deleteProduct);
router.put(
  '/updateproductbyadmin/:product_id',
  upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'gallery_images', maxCount: 4 },
    { name: 'product_video', maxCount: 1 },
    { name: 'product_reel', maxCount: 1 }
  ]),verifyTokenforactions, 
  productController.updateProduct
);
router.put(
  '/updateproductstatus/:product_id',verifyTokenforactions, 
  productController.updateProductStatus
);

router.get('/buyer-stats', verifyTokenforactions,  adminController.getBuyerStats);
router.get('/buyers-view', verifyTokenforactions, adminController.adminBuyersView);
router.put('/update-buyerbyadmin',verifyTokenforactions,adminController.updateBuyerbyAdmin);
router.put('/update-buyer-status', verifyTokenforactions, adminController.updateBuyerSellerStatus);

router.get('/seller-stats', verifyTokenforactions,  adminController.getSellersStats);
router.get('/seller-view', verifyTokenforactions, adminController.adminSellersView);
router.put(
  '/update-sellerbyadmin',
  verifyTokenforactions,
  upload.fields([
    { name: 'profile_image', maxCount: 1 },
    { name: 'store_image', maxCount: 1 }
  ]),
  adminController.updateSellerbyAdmin
);
router.post('/update-seller-approval', verifyTokenforactions, adminController.updateSellerStatus);
router.delete('/delete-sellerbyadmin/:seller_id', verifyTokenforactions, adminController.deleteSellerAccount);

router.get('/order-stats', verifyTokenforactions,  adminController.getOrderStats);
router.get('/orders-view', verifyTokenforactions, adminController.adminOrdersView);
router.put('/orderstatus-update', verifyTokenforactions, adminController.adminOrderStatusUpdate);
router.delete('/order-delete/:order_id', verifyTokenforactions, adminController.deleteOrderbyAdmin);
router.get('/revenue-stats', verifyTokenforactions,  adminController.getRevenueStats);
router.get('/revenue-details', verifyTokenforactions, adminController.adminRevenueView);


router.post(
  '/add-banner',
  verifyTokenforactions,
  upload.fields([
    { name: 'banner', maxCount: 1 }
  ]),
  adminController.createBanner
);
router.get('/auth/me',verifyTokenforactions, adminController.getAdminProfileDetails);
router.get('/getbanner' ,adminController.getBanners);
router.get('/getbannerbyid/:banner_id' ,adminController.getBannerByID);
router.delete('/delete-banner/:banner_id' , verifyTokenforactions ,adminController.deleteBanner);
// router.delete('/deletebanner/:banner_id',verifyTokenforactions  ,adminController.deleteBanner);
router.put(
  '/update-banner/:banner_id',
  verifyTokenforactions,
  upload.fields([
    { name: 'banner', maxCount: 1 } // image OR video
  ]),
  adminController.updateBanner
);
router.get('/settlements', verifyTokenforactions, adminController.getAdminSettlements);
module.exports = router;