const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/orderModel');
const settlementService = require('../utils/settlementService');
require('dotenv').config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ✅ Create Razorpay Order
exports.createRazorpayOrder = async (req, res) => {
  const { amount, currency = 'INR' } = req.body;

  if (!amount) {
    return res.status(400).json({ status: false, message: 'Amount is required' });
  }

  const options = {
    amount: amount * 100, // amount in the smallest currency unit
    currency,
    receipt: `receipt_${Date.now()}`,
  };

  try {
    const order = await razorpay.orders.create(options);
    res.status(200).json({
      status: true,
      message: 'Razorpay order created successfully',
      data: order,
    });
  } catch (error) {
    console.error('Razorpay Order Creation Error:', error);
    res.status(500).json({ status: false, message: 'Failed to create Razorpay order', error });
  }
};

// ✅ Verify Razorpay Payment and Create Order
exports.verifyRazorpayPayment = async (req, res) => {
  const userId = req.user?.id;
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderDetails // { total_amount, shipping_address_id, items, buyer_note }
  } = req.body;

  if (!userId) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderDetails) {
    return res.status(400).json({ status: false, message: 'Missing required payment verification fields' });
  }

  // Verify signature
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  const isSignatureValid = expectedSignature === razorpay_signature;

  if (!isSignatureValid) {
    return res.status(400).json({ status: false, message: 'Invalid payment signature' });
  }

  // Payment is verified, now create the actual order in DB
  const { total_amount, shipping_address_id, items, buyer_note } = orderDetails;

  // Generate local UIDs
  const order_uid = `ORD${Date.now()}`;
  const payment_uid = razorpay_payment_id; // Using razorpay payment ID as local payment UID

  // Get seller_id from first item
  const seller_id = items[0]?.seller_id;

  Order.createOrder(
    userId,
    {
      order_uid,
      total_amount,
      order_status: 1, // Assuming 1 is 'Processing' or 'Confirmed'
      payment_status: 1, // Assuming 1 is 'Paid'
      payment_type: 'Online',
      payment_method: 'Razorpay',
      payment_uid,
      razorpay_order_id,
      shipping_address_id,
      seller_id,
      buyer_note
    },
    (err, orderResult) => {
      if (err) {
        console.error("Order Creation Error after Razorpay verification:", err);
        return res.status(500).json({ status: false, message: "Payment verified but failed to create order in database" });
      }

      const orderId = orderResult.order_id;

      Order.createOrderItems(orderId, items, (itemErr) => {
        if (itemErr) {
          console.error("Order Items Error after Razorpay verification:", itemErr);
          return res.status(500).json({ status: false, message: "Payment verified but failed to insert order items" });
        }

        // Trigger settlement process
        settlementService.triggerSettlementIfOnline(orderId, seller_id, total_amount, 1, 'Online');

        Order.getOrderById(orderId, userId, (fetchErr, newOrder) => {
          if (fetchErr) {
            return res.status(201).json({
              status: true,
              message: "Payment verified and order created successfully",
              order_id: orderId
            });
          }

          return res.status(201).json({
            status: true,
            message: "Payment verified and order created successfully",
            data: newOrder
          });
        });
      });
    }
  );
};
