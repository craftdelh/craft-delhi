const orderTrackingModel = require('../models/orderTrackingModel');
const Order = require('../models/orderModel'); // for ownership check
const authorizeAction = require('../utils/authorizeAction');
const {addTrackingAuthorized, updateTrackingAuthorized} = require('../utils/updateUtils');

// Add tracking info (only order owner can add)
exports.addTrackingInfo = (req, res) => {
  const { order_id, tracking_company, tracking_number, tracking_link, estimated_delivery_from, estimated_delivery_to, status } = req.body;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!order_id || !tracking_company || !tracking_number || !tracking_link) {
    return res.status(400).json({ message: 'Order ID, tracking company, tracking number, and tracking link are required.' });
  }

  const trackingData = {
    order_id,
    tracking_company,
    tracking_number,
    tracking_link,
    estimated_delivery_from,
    estimated_delivery_to,
    status
  };

  // 🔹 Allow Admin or Seller (who owns this order)
  if (roleId === parseInt(process.env.Admin_role_id)) {
    return addTrackingAuthorized(order_id, trackingData, res);
  }

  authorizeAction(
    Order,
    order_id,
    userId,
    { getMethod: 'getOrderByIDforVerification', ownerField: 'seller_id' },
    async (authError) => {
      if (authError) {
        return res.status(authError.code).json({ status: false, message: authError.message });
      }
      await addTrackingAuthorized(order_id, trackingData, res);
    }
  );
};

// Get tracking info by order ID
exports.getTrackingByOrder = (req, res) => {
  const { order_id } = req.params;

  orderTrackingModel.getTrackingByOrderId(order_id, (err, results) => {
    if (err) {
      console.error('Error fetching tracking info:', err);
      return res.status(500).json({ message: 'Failed to fetch tracking info.' });
    }

    const formatted = results.map(row => ({
      ...row,
      status_text:
        row.status === 0 ? 'Pending' :
        row.status === 1 ? 'Shipped' :
        row.status === 2 ? 'In Transit' :
        row.status === 3 ? 'Delivered' :
        row.status === 4 ? 'Cancelled' : 'Unknown'
    }));

    res.status(200).json(formatted);
  });
};

// 🔄 Update tracking info (only owner can update)
exports.updateTrackingInfo = (req, res) => {
  const { id } = req.params;
  const { tracking_company, tracking_number, tracking_link, estimated_delivery_from, estimated_delivery_to, status, order_id } = req.body;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  const data = { tracking_company, tracking_number, tracking_link, estimated_delivery_from, estimated_delivery_to, status };

  if (!order_id) {
    return res.status(400).json({ message: 'Order ID is required for update authorization.' });
  }

  // 🔹 Allow Admin or Seller (who owns this order)
  if (roleId === parseInt(process.env.Admin_role_id)) {
    return updateTrackingAuthorized(id, data, order_id, res);
  }

  authorizeAction(
    Order,
    order_id,
    userId,
    { getMethod: 'getOrderByIDforVerification', ownerField: 'seller_id' },
    async (authError) => {
      if (authError) {
        return res.status(authError.code).json({ status: false, message: authError.message });
      }
      await updateTrackingAuthorized(id, data, order_id, res);
    }
  );
};
