const express = require('express');

const router = express.Router();

const customOrderController = require('../controllers/customOrderController');

const { verifyTokenforactions } = require('../utils/authMiddleware');

// ✅ Create
router.post(
  '/create',
  verifyTokenforactions,
  customOrderController.createCustomOrder
);

// ✅ User Orders
router.get(
  '/my-orders',
  verifyTokenforactions,
  customOrderController.getCustomOrdersByUser
);

// ✅ Seller Orders
router.get(
  '/seller-orders',
  verifyTokenforactions,
  customOrderController.getCustomOrdersBySeller
);

// ✅ Single Order
router.get(
  '/:order_id',
  verifyTokenforactions,
  customOrderController.getCustomOrderById
);

// ✅ Update
router.put(
  '/:order_id',
  verifyTokenforactions,
  customOrderController.updateCustomOrder
);

// ✅ Update Status
router.put(
  '/status/:order_id',
  verifyTokenforactions,
  customOrderController.updateCustomOrderStatus
);

// ✅ Delete
router.delete(
  '/:order_id',
  verifyTokenforactions,
  customOrderController.deleteCustomOrder
);

module.exports = router;