const CustomOrder = require('../models/customOrderModel');

// ✅ Create Custom Order
exports.createCustomOrder = (req, res) => {

  const userId = req.user?.id;

  const {
    seller_id,
    customer_name,
    customer_phone,
    product_details,
    quantity,
    price,
    customize_description,
    shipping_address,
    buyer_note
  } = req.body;

  if (
    !customer_name ||
    !customer_phone ||
    !product_details ||
    !shipping_address
  ) {
    return res.status(400).json({
      status: false,
      message: 'Missing required fields'
    });
  }

  const custom_order_uid = `CUST${Date.now()}`;

  CustomOrder.createCustomOrder(
    {
      custom_order_uid,
      user_id: userId,
      seller_id,
      customer_name,
      customer_phone,
      product_details,
      quantity: quantity || 1,
      price: price || 0,
      customize_description,
      shipping_address,
      buyer_note,
      order_status: 0
    },
    (err, result) => {

      if (err) {
        console.error(err);

        return res.status(500).json({
          status: false,
          message: 'Failed to create custom order'
        });
      }

      return res.status(201).json({
        status: true,
        message: 'Custom order created successfully',
        data: result
      });

    }
  );

};

// ✅ User Orders
exports.getCustomOrdersByUser = (req, res) => {

  const userId = req.user?.id;

  CustomOrder.getCustomOrdersByUser(userId, (err, orders) => {

    if (err) {
      return res.status(500).json({
        status: false,
        message: 'Failed to fetch orders'
      });
    }

    return res.status(200).json({
      status: true,
      data: orders
    });

  });

};

// ✅ Seller Orders
exports.getCustomOrdersBySeller = (req, res) => {

  const sellerId = req.user?.id;

  CustomOrder.getCustomOrdersBySeller(sellerId, (err, orders) => {

    if (err) {
      return res.status(500).json({
        status: false,
        message: 'Failed to fetch seller orders'
      });
    }

    return res.status(200).json({
      status: true,
      data: orders
    });

  });

};

// ✅ Get Single Order
exports.getCustomOrderById = (req, res) => {

  const { order_id } = req.params;

  CustomOrder.getCustomOrderById(order_id, (err, order) => {

    if (err) {
      return res.status(500).json({
        status: false,
        message: 'Failed to fetch order'
      });
    }

    if (!order) {
      return res.status(404).json({
        status: false,
        message: 'Order not found'
      });
    }

    return res.status(200).json({
      status: true,
      data: order
    });

  });

};

// ✅ Update Order
exports.updateCustomOrder = (req, res) => {

  const { order_id } = req.params;

  CustomOrder.updateCustomOrder(
    order_id,
    req.body,
    (err) => {

      if (err) {

        return res.status(500).json({
          status: false,
          message: err.message || 'Failed to update order'
        });

      }

      return res.status(200).json({
        status: true,
        message: 'Custom order updated successfully'
      });

    }
  );

};

// ✅ Update Status
exports.updateCustomOrderStatus = (req, res) => {

  const { order_id } = req.params;
  const { order_status } = req.body;

  if (order_status === undefined) {
    return res.status(400).json({
      status: false,
      message: 'Order status is required'
    });
  }

  CustomOrder.updateCustomOrder(
    order_id,
    { order_status },
    (err) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: 'Failed to update status'
        });
      }

      return res.status(200).json({
        status: true,
        message: 'Order status updated successfully'
      });

    }
  );

};

// ✅ Delete Order
exports.deleteCustomOrder = (req, res) => {

  const { order_id } = req.params;

  CustomOrder.deleteCustomOrder(order_id, (err) => {

    if (err) {
      return res.status(500).json({
        status: false,
        message: 'Failed to delete order'
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Custom order deleted successfully'
    });

  });

};