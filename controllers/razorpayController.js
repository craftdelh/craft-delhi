const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/orderModel');
const settlementService = require('../utils/settlementService');
require('dotenv').config();

// Helper to initialize Razorpay SDK instance
const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  
  if (!key_id || !key_secret) {
    throw new Error('Razorpay Key ID or Secret is not configured in server environment variables');
  }

  return new Razorpay({ key_id, key_secret });
};

// ✅ Create Razorpay Order
exports.createRazorpayOrder = async (req, res) => {
  const { amount, currency = 'INR', receipt } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({
      status: false,
      message: 'Valid amount is required'
    });
  }

  try {
    const razorpay = getRazorpayInstance();

    const options = {
      amount: Math.round(parseFloat(amount) * 100), // convert INR to paise
      currency: currency,
      receipt: receipt || `rcpt_${Date.now()}`
    };

    const razorpayOrder = await razorpay.orders.create(options);

    return res.status(200).json({
      status: true,
      message: 'Razorpay order created successfully',
      data: {
        key_id: process.env.RAZORPAY_KEY_ID,
        order_id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt
      }
    });
  } catch (error) {
    console.error('Razorpay Order Creation Error:', error);
    return res.status(500).json({
      status: false,
      message: error.message || 'Failed to create Razorpay order',
      error
    });
  }
};

// ✅ Verify Razorpay Payment Signature and Create Local Order
exports.verifyRazorpayPayment = async (req, res) => {
  const userId = req.user?.id;
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderDetails
  } = req.body;

  if (!userId) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderDetails) {
    return res.status(400).json({
      status: false,
      message: 'Missing required payment verification fields'
    });
  }

  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_secret) {
    return res.status(500).json({
      status: false,
      message: 'Razorpay Key Secret is not configured in server environment variables'
    });
  }

  try {
    // Generate HMAC SHA256 signature
    const hmac = crypto.createHmac('sha256', key_secret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');

    const isSignatureValid = generatedSignature === razorpay_signature;

    if (!isSignatureValid) {
      return res.status(400).json({
        status: false,
        message: 'Invalid payment signature'
      });
    }

    // Payment is verified. Now create order in local database
    const { total_amount, shipping_address_id, items, buyer_note } = orderDetails;

    if (!total_amount || !shipping_address_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: false,
        message: 'Invalid orderDetails format'
      });
    }

    const order_uid = `ORD${Date.now()}`;
    const payment_uid = razorpay_payment_id; // Razorpay payment ID as reference
    const seller_id = items[0]?.seller_id;

    Order.createOrder(
      userId,
      {
        order_uid,
        total_amount,
        order_status: 1, // Confirmed
        payment_status: 1, // Paid
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
          return res.status(500).json({
            status: false,
            message: "Payment verified successfully but failed to save order to local database"
          });
        }

        const orderId = orderResult.order_id;

        Order.createOrderItems(orderId, items, (itemErr) => {
          if (itemErr) {
            console.error("Order Items Insertion Error after Razorpay verification:", itemErr);
            return res.status(500).json({
              status: false,
              message: "Payment verified successfully but failed to insert order items"
            });
          }

          // Trigger settlement process using the Razorpay payout service (Currently ON HOLD via ENABLE_SETTLEMENT_PROCESS=false)
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
  } catch (error) {
    console.error('Razorpay Payment Verification Error:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to verify payment',
      error: error.message || error
    });
  }
};
