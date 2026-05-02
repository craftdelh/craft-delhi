const Order = require('../models/orderModel');
const authorizeAction = require('../utils/authorizeAction');
const OrderTracking = require('../models/orderTrackingModel');
const {handleOrderAndTrackingUpdate, updateOrderStatusOnly, markOrderAsCancelled} = require('../utils/updateUtils');
const {generateInvoicePDF} = require('../utils/invoiceGenerator');

// ✅ Create Order
exports.createOrder = (req, res) => {
  const userId = req.user?.id;
  const {
    total_amount,
    order_status,
    payment_status,
    payment_type,
    payment_method,
    shipping_address_id,
    items,
    buyer_note
  } = req.body;
  // 🧾 Validation
  if (!userId) {
    return res.status(401).json({ status: false, message: "Unauthorized: User ID not found" });
  }

  if (
    total_amount == null ||
    payment_type == null ||
    payment_status == null ||
    shipping_address_id == null ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return res.status(400).json({ status: false, message: "Missing required fields" });
  }

  // ✅ Generate UIDs
  const order_uid = `ORD${Date.now()}`;
  const payment_uid = `PAY${Math.floor(1000 + Math.random() * 9000)}`; // e.g. PAY1234

  // ✅ Get seller_id from first item
  const seller_id = items[0].seller_id;

  // ✅ Create order and payment in model
  Order.createOrder(
    userId,
    {
      order_uid,
      total_amount,
      order_status,
      payment_status,
      payment_type,
      payment_method,
      payment_uid,
      razorpay_order_id: null, // No razorpay order ID for direct/COD orders
      shipping_address_id,
      seller_id,
      buyer_note
    },
    (err, orderResult) => {
      if (err) {
        console.error("Order Creation Error:", err);
        return res.status(500).json({ status: false, message: "Failed to create order" });
      }

      const orderId = orderResult.order_id;

      // ✅ Insert order items
      Order.createOrderItems(orderId, items, (itemErr) => {
        if (itemErr) {
          console.error("Order Items Error:", itemErr);
          return res.status(500).json({ status: false, message: "Failed to insert order items" });
        }

        // ✅ Fetch full order details after creation
        Order.getOrderById(orderId, userId, (fetchErr, newOrder) => {
          if (fetchErr) {
            console.error("Fetch Error:", fetchErr);
            return res.status(500).json({ status: false, message: "Failed to fetch order" });
          }

          return res.status(201).json({
            status: true,
            message: "Order and payment created successfully",
            data: newOrder
          });
        });
      });
    }
  );
};

exports.recentOrderbySeller = (req, res) => {
  const seller_id = req.user?.id;

  if (!seller_id) {
    return res.status(401).json({ status: false, message: 'Unauthorized: User ID not found' });
  }

  // You can limit recent orders to last 5 or 10 — customize as needed
  Order.getrecentOrdersbySellerID (seller_id, (err, orders) => {
    if (err) {
      console.error('Fetch Recent Orders Error:', err);
      return res.status(500).json({ status: false, message: 'Failed to fetch orders' });
    }

    if (!orders || orders.length === 0) {
      return res.status(404).json({ status: false, message: 'No orders found' });
    }

    return res.status(200).json({
      status: true,
      message: 'orders fetched successfully',
      data: orders
    });
  });
};

exports.updateOrderStatus = (req, res) => {
  const { order_id } = req.params;
  const { order_status } = req.body;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!order_id) {
    return res.status(400).json({ status: false, message: 'Order ID is required' });
  }

  if (typeof order_status === 'undefined') {
    return res.status(400).json({ status: false, message: 'Order status value is required' });
  }

  // 🔹 If Admin — can update any order
  if (roleId === parseInt(process.env.Admin_role_id)) {
    return Order.getOrderByIDforVerification(order_id, async (err, existingOrder) => {
      if (err || !existingOrder) {
        return res.status(404).json({ status: false, message: 'Order not found' });
      }

      await updateOrderStatusOnly(order_id, order_status, res);
    });
  }

  // 🔹 If Seller — must own the order
  authorizeAction(
    Order,
    order_id,
    userId,
    { getMethod: 'getOrderByIDforVerification', ownerField: 'seller_id' },
    async (authError, existingOrder) => {
      if (authError) {
        return res.status(authError.code).json({ status: false, message: authError.message });
      }

      await updateOrderStatusOnly(order_id, order_status, res);
    }
  );
};

exports.getsellerOrderSummary = (req, res) => {
  const sellerId = req.user?.id;

  if (req.user.role !== 2) {
    return res.status(403).json({ status: false, message: 'Only sellers can access store details.' });
  }

  if (!sellerId || isNaN(sellerId)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  Order.getOrderSummary(sellerId, (err, order) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (!order) {
      return res.status(404).json({ status: false, message: 'order summary not found for this seller' });
    }

    return res.status(200).json({
      status: true,
      message: 'Order summary fetched successfully.',
      order
    });
  });
};

exports.updateOrderDetails = (req, res) => {
  const { order_id } = req.params;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!order_id) {
    return res.status(400).json({ status: false, message: 'Order ID is required' });
  }

  // Extract all fields from body
  const {
    order_status,
    total_amount,
    buyer_note,
    payment_status,
    payment_method,
    payment_type,
    shipping_address_id,
    tracking_company,
    tracking_number,
    tracking_link,
    estimated_delivery_from,
    estimated_delivery_to,
    tracking_status
  } = req.body;

  // Prepare order data
  const orderData = {};
  if (order_status !== undefined) orderData.order_status = order_status;
  if (total_amount !== undefined) orderData.total_amount = total_amount;
  if (buyer_note !== undefined) orderData.buyer_note = buyer_note;
  if (shipping_address_id !== undefined) orderData.shipping_address_id = shipping_address_id;

  // Prepare payment data (FIXED)
  const paymentData = {};
  if (payment_status !== undefined) paymentData.payment_status = payment_status;
  if (payment_method !== undefined) paymentData.payment_method = payment_method;
  if (payment_type !== undefined) paymentData.payment_type = payment_type;

  // Prepare tracking data
  const trackingData = {
    order_id,
  };
  if (tracking_company !== undefined) trackingData.tracking_company = tracking_company;
  if (tracking_number !== undefined) trackingData.tracking_number = tracking_number;
  if (tracking_link !== undefined) trackingData.tracking_link = tracking_link;
  if (estimated_delivery_from !== undefined) trackingData.estimated_delivery_from = estimated_delivery_from;
  if (estimated_delivery_to !== undefined) trackingData.estimated_delivery_to = estimated_delivery_to;
  if (tracking_status !== undefined) trackingData.status = tracking_status;

  // Admin logic
  if (Number(roleId) === Number(process.env.Admin_role_id)) {
    return Order.getOrderByIDforVerification(order_id, async (err, existingOrder) => {

      if (err) {
        return res.status(500).json({ status: false, message: 'Database error' });
      }
      if (!existingOrder) {
        return res.status(404).json({ status: false, message: 'Order not found' });
      }

      await handleOrderAndTrackingUpdate(order_id, orderData, trackingData, paymentData, res);
    });
  }

  // Seller logic
  authorizeAction(
    Order,
    order_id,
    userId,
    { getMethod: 'getOrderByIDforVerification', ownerField: 'seller_id' },
    async (authError, existingOrder) => {
      if (authError) {
        return res.status(authError.code).json({ status: false, message: authError.message });
      }

      await handleOrderAndTrackingUpdate(order_id, orderData, trackingData, paymentData, res);
    }
  );
};

exports.OrderbyUser = (req, res) => {
  const user_id = req.user?.id;

  if (!user_id) {
    return res.status(401).json({ status: false, message: 'Unauthorized: User ID not found' });
  }

  // You can limit recent orders to last 5 or 10 — customize as needed
  Order.getOrdersbyUserID (user_id, (err, orders) => {
    if (err) {
      console.error('Fetch Recent Orders Error:', err);
      return res.status(500).json({ status: false, message: 'Failed to fetch recent orders' });
    }

    if (!orders || orders.length === 0) {
      return res.status(404).json({ status: false, message: 'No recent orders found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Recent orders fetched successfully',
      data: orders
    });
  });
};

exports.cancelOrderbyUser = (req, res) => {
  const { order_id } = req.params;
  const { cancel_reason } = req.body;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!order_id) {
    return res.status(400).json({ status: false, message: 'Order ID is required' });
  }

  if (!cancel_reason || cancel_reason.trim().length < 3) {
    return res.status(400).json({
      status: false,
      message: 'Cancel reason is required'
    });
  }

  // 🔹 Admin
  if (roleId === process.env.ADMIN_ROLE_ID) {
    return Order.getOrderByIDforVerification(order_id, (err, existingOrder) => {
      if (err || !existingOrder) {
        return res.status(404).json({ status: false, message: 'Order not found' });
      }

      return markOrderAsCancelled(order_id, 4, cancel_reason, res);
    });
  }

  // 🔹 Seller / User authorization
  authorizeAction(
    Order,
    order_id,
    userId,
    { getMethod: 'getOrderByIDforVerification', ownerField: 'user_id' },
    (authError) => {
      if (authError) {
        return res.status(authError.code).json({
          status: false,
          message: authError.message
        });
      }

      return markOrderAsCancelled(order_id, 4, cancel_reason, res);
    }
  );
};

exports.getOrderInvoice = (req, res) => {
  const user_id = req.user?.id;
  const order_id = req.params?.order_id;

  if (!user_id) {
    return res
      .status(401)
      .json({ status: false, message: 'Unauthorized' });
  }

  authorizeAction(
    Order,
    order_id,
    user_id,
    { getMethod: 'getOrderByIDforVerification', ownerField: 'user_id' },
    async (authError) => {
      if (authError) {
        return res
          .status(authError.code)
          .json({ status: false, message: authError.message });
      }

      Order.getOrdersInvoiceById(order_id, (err, orderData) => {
        if (err || !orderData?.length) {
          return res
            .status(404)
            .json({ status: false, message: 'Order not found' });
        }

        // Generate & download PDF
        generateInvoicePDF(orderData[0], res);
      });
    }
  );
};
