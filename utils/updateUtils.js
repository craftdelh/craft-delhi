const Order = require('../models/orderModel');
const Payment = require('../models/paymentModel');
const orderTrackingModel = require('../models/orderTrackingModel');
const { sendNotification } = require('./notificationHelper');

/**
 * Updates an order and optionally adds/updates its tracking info.
 *
 * @param {number} order_id - The ID of the order to update.
 * @param {object} orderData - The fields to update in order_details.
 * @param {object} trackingData - The tracking details (optional).
 * @param {object} res - Express response object.
 */

const db = require('../config/db');

const checkPaymentProcessedForDelivery = (order_id, paymentStatusPayload) => {
  return new Promise((resolve, reject) => {
    if (paymentStatusPayload !== undefined && paymentStatusPayload !== null && Number(paymentStatusPayload) === 1) {
      return resolve(true);
    }
    const sql = `SELECT payment_status FROM payments WHERE order_id = ? LIMIT 1`;
    db.query(sql, [order_id], (err, results) => {
      if (err) return reject(err);
      if (!results || results.length === 0) return resolve(false);
      return resolve(Number(results[0].payment_status) === 1);
    });
  });
};

exports.checkPaymentProcessedForDelivery = checkPaymentProcessedForDelivery;

exports.handleOrderAndTrackingUpdate = async (order_id, orderData = {}, trackingData = {}, paymentData = {}, res) => {
  try {
    const isOrderRestricted = orderData.order_status !== undefined && [2, 3].includes(Number(orderData.order_status));
    const isTrackingRestricted = trackingData.status !== undefined && [2, 3].includes(Number(trackingData.status));

    if (isOrderRestricted || isTrackingRestricted) {
      const isPaid = await checkPaymentProcessedForDelivery(order_id, paymentData.payment_status);
      if (!isPaid) {
        const targetStatus = isOrderRestricted ? Number(orderData.order_status) : Number(trackingData.status);
        const statusLabel = targetStatus === 2 ? 'Out for Delivery' : 'Delivered';
        return res.status(400).json({
          status: false,
          message: `Cannot mark order as ${statusLabel} because the payment is not processed/paid. Payment status must be Paid (1).`
        });
      }
    }

    const hasOrderFields = Object.keys(orderData).length > 0;
    const hasPaymentFields = Object.keys(paymentData).length > 0;

    const hasTrackingFields = Object.values(trackingData).some(
      (v) => v !== undefined && v !== null && v !== ""
    );

    // Convert callbacks to promises
    const updateOrder = (order_id, data) =>
      new Promise((resolve, reject) => {
        Order.updateOrderByID(order_id, data, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

    const updatePayment = (order_id, data) =>
      new Promise((resolve, reject) => {
        Payment.updatePaymentByOrderID(order_id, data, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

    const checkTracking = (order_id) =>
      new Promise((resolve, reject) => {
        orderTrackingModel.checkTrackingExists(order_id, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

    const updateTracking = (id, data) =>
      new Promise((resolve, reject) => {
        orderTrackingModel.updateTracking(id, data, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

    const addTracking = (data) =>
      new Promise((resolve, reject) => {
        orderTrackingModel.addTracking(data, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

    // 1️⃣ Update Order
    if (hasOrderFields) {
      await updateOrder(order_id, orderData);
    }

    // 2️⃣ Update Payment
    if (hasPaymentFields) {
      await updatePayment(order_id, paymentData);
    }

    // 3️⃣ Tracking update
    if (hasTrackingFields) {
      const validTrackingData = {};

      Object.keys(trackingData).forEach((key) => {
        const value = trackingData[key];

        // ❌ skip undefined, null, empty string
        if (value === undefined || value === null || value === '') return;

        // ✅ convert status to number safely
        if (key === 'status') {
          validTrackingData[key] = Number(value);
        } else {
          validTrackingData[key] = value;
        }
      });

      const trackingResult = await checkTracking(order_id);

      if (trackingResult.length > 0) {
        await updateTracking(trackingResult[0].id, validTrackingData);
      } else {
        await addTracking(validTrackingData);
      }

      return res.status(200).json({
        status: true,
        message:
          hasOrderFields
            ? "Order and tracking details updated successfully"
            : hasPaymentFields
              ? "Payment and tracking details updated successfully"
              : "Tracking details updated successfully",
      });
    }

    // 4️⃣ Only order updated
    if (hasOrderFields) {
      return res.status(200).json({
        status: true,
        message: "Order details updated successfully",
      });
    }

    // 5️⃣ Only payment updated (ADDED THIS)
    if (hasPaymentFields) {
      return res.status(200).json({
        status: true,
        message: "Payment details updated successfully",
      });
    }

    // 6️⃣ Nothing provided
    return res.status(400).json({
      status: false,
      message: "No valid data provided to update",
    });

  } catch (error) {
    console.error("❌ Order update error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};

exports.updateOrderStatusOnly = async (order_id, order_status, res) => {
  try {
    if (order_status !== undefined && [2, 3].includes(Number(order_status))) {
      const isPaid = await checkPaymentProcessedForDelivery(order_id);
      if (!isPaid) {
        const statusLabel = Number(order_status) === 2 ? 'Out for Delivery' : 'Delivered';
        return res.status(400).json({
          status: false,
          message: `Cannot mark order as ${statusLabel} because the payment is not processed/paid. Payment status must be Paid (1).`
        });
      }
    }

    Order.updateOrderByID(order_id, { order_status }, (err, result) => {
      if (err) {
        console.error('❌ DB update error:', err);
        return res.status(500).json({
          status: false,
          message: 'Error updating order status'
        });
      }

      if (result.affectedRows > 0) {
        // Trigger Notifications for Buyer & Seller
        Order.getOrderByIDforVerification(order_id, (fetchErr, orderInfo) => {
          if (!fetchErr && orderInfo) {
            const statusNames = { 0: 'Pending', 1: 'Confirmed', 2: 'Shipped', 3: 'Delivered', 4: 'Cancelled' };
            const statusLabel = statusNames[order_status] || 'Updated';
            const publicOrderId = orderInfo.order_uid || order_id;

            if (orderInfo.user_id) {
              sendNotification({
                userId: orderInfo.user_id,
                title: `Order Status: ${statusLabel}`,
                message: `Your order #${publicOrderId} status has been updated to ${statusLabel}.`,
                type: 'ORDER_STATUS',
                referenceId: order_id
              }).catch(e => console.error("Buyer Status Notification Error:", e));
            }
            if (orderInfo.seller_id) {
              sendNotification({
                userId: orderInfo.seller_id,
                title: `Order Status: ${statusLabel}`,
                message: `Order #${publicOrderId} status updated to ${statusLabel}.`,
                type: 'ORDER_STATUS',
                referenceId: order_id
              }).catch(e => console.error("Seller Status Notification Error:", e));
            }
          }
        });

        return res.status(200).json({
          status: true,
          message: 'Order status updated successfully'
        });
      } else {
        return res.status(400).json({
          status: false,
          message: 'No order updated (possibly same status)'
        });
      }
    });
  } catch (error) {
    console.error('❌ Status update error:', error);
    return res.status(500).json({
      status: false,
      message: 'Error updating order status'
    });
  }
};

exports.addTrackingAuthorized = async (order_id, trackingData, res) => {
  try {
    if (trackingData.status !== undefined && [2, 3].includes(Number(trackingData.status))) {
      const isPaid = await checkPaymentProcessedForDelivery(order_id);
      if (!isPaid) {
        const statusLabel = Number(trackingData.status) === 2 ? 'Out for Delivery' : 'Delivered';
        return res.status(400).json({
          status: false,
          message: `Cannot mark order as ${statusLabel} because the payment is not processed/paid. Payment status must be Paid (1).`
        });
      }
    }

    // 🔹 Check if tracking already exists for this order
    orderTrackingModel.checkTrackingExists(order_id, (checkErr, result) => {
      if (checkErr) {
        console.error('❌ Error checking tracking info:', checkErr);
        return res.status(500).json({
          status: false,
          message: 'Server error while checking tracking info.'
        });
      }

      if (result.length > 0) {
        return res.status(400).json({
          status: false,
          message: 'Tracking info already exists for this order. Use update API.'
        });
      }

      // 🔹 Filter out undefined or null fields before insert
      const filteredData = Object.keys(trackingData)
        .filter(key => trackingData[key] !== undefined && trackingData[key] !== null)
        .reduce((obj, key) => {
          obj[key] = trackingData[key];
          return obj;
        }, {});

      // 🔹 Add new tracking info
      orderTrackingModel.addTracking(filteredData, (err, result) => {
        if (err) {
          console.error('❌ Error adding tracking info:', err);
          return res.status(500).json({
            status: false,
            message: 'Failed to add tracking info.'
          });
        }

        return res.status(201).json({
          status: true,
          message: 'Tracking info added successfully.',
          id: result.insertId
        });
      });
    });
  } catch (error) {
    console.error('❌ Error in addTrackingAuthorized:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while adding tracking info.'
    });
  }
};

exports.updateTrackingAuthorized = async (id, data, order_id, res) => {
  try {
    const responseObj = res || order_id;
    const targetOrderId = (typeof order_id === 'number' || typeof order_id === 'string') ? order_id : null;

    if (data.status !== undefined && [2, 3].includes(Number(data.status)) && targetOrderId) {
      const isPaid = await checkPaymentProcessedForDelivery(targetOrderId);
      if (!isPaid) {
        const statusLabel = Number(data.status) === 2 ? 'Out for Delivery' : 'Delivered';
        return responseObj.status(400).json({
          status: false,
          message: `Cannot mark order as ${statusLabel} because the payment is not processed/paid. Payment status must be Paid (1).`
        });
      }
    }

    orderTrackingModel.updateTracking(id, data, (err, result) => {
      if (err) {
        console.error('Error updating tracking info:', err);
        return responseObj.status(500).json({ message: 'Failed to update tracking info.' });
      }
      responseObj.status(200).json({ message: 'Tracking info updated successfully.' });
    });
  } catch (error) {
    console.error('Error in updateTrackingAuthorized:', error);
  }
};

exports.runQuery = (connection, sql, params) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.markOrderAsCancelled = async (order_id, order_status, cancel_reason, res) => {
  try {
    Order.updateOrderByID(order_id, { order_status, cancel_reason }, (err, result) => {
      if (err) {
        console.error('❌ DB update error:', err);
        return res.status(500).json({
          status: false,
          message: 'Error updating order status'
        });
      }

      if (result.affectedRows > 0) {
        Order.getOrderByIDforVerification(order_id, (fetchErr, orderInfo) => {
          if (!fetchErr && orderInfo) {
            const publicOrderId = orderInfo.order_uid || order_id;
            if (orderInfo.user_id) {
              sendNotification({
                userId: orderInfo.user_id,
                title: 'Order Cancelled',
                message: `Your order #${publicOrderId} was cancelled. Reason: ${cancel_reason}`,
                type: 'ORDER_CANCELLED',
                referenceId: order_id
              }).catch(e => console.error("Buyer Cancel Notification Error:", e));
            }
            if (orderInfo.seller_id) {
              sendNotification({
                userId: orderInfo.seller_id,
                title: 'Order Cancelled',
                message: `Order #${publicOrderId} was cancelled. Reason: ${cancel_reason}`,
                type: 'ORDER_CANCELLED',
                referenceId: order_id
              }).catch(e => console.error("Seller Cancel Notification Error:", e));
            }
          }
        });

        return res.status(200).json({
          status: true,
          message: 'Order status updated successfully'
        });
      } else {
        return res.status(400).json({
          status: false,
          message: 'No order updated (possibly same status)'
        });
      }
    });
  } catch (error) {
    console.error('❌ Status update error:', error);
    return res.status(500).json({
      status: false,
      message: 'Error updating order status'
    });
  }
};
