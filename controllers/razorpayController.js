const crypto = require('crypto');
const Razorpay = require('razorpay');
const jwt = require('jsonwebtoken');
const Order = require('../models/orderModel');
const settlementService = require('../utils/settlementService');
const { sendNotification } = require('../utils/notificationHelper');
require('dotenv').config();

const getRazorpayKeys = () => {
  const mode = (process.env.RAZORPAY_MODE || 'test').toLowerCase();
  const isLive = mode === 'live';

  const key_id = isLive
    ? (process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_KEY_ID)
    : (process.env.RAZORPAY_TEST_KEY_ID || process.env.RAZORPAY_KEY_ID);

  const key_secret = isLive
    ? (process.env.RAZORPAY_LIVE_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)
    : (process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);

  return { mode, key_id, key_secret };
};

// Helper to initialize Razorpay SDK instance
const getRazorpayInstance = () => {
  const { key_id, key_secret } = getRazorpayKeys();
  
  if (!key_id || !key_secret) {
    throw new Error('Razorpay Key ID or Secret is not configured in server environment variables');
  }

  return new Razorpay({ key_id, key_secret });
};

const getChatServiceUrl = () => (
  process.env.CHAT_SERVICE_URL || 'http://localhost:3000'
).replace(/\/$/, '');

const fetchQuotation = async (quotationId, authorization) => {
  const response = await fetch(`${getChatServiceUrl()}/quotations/${quotationId}`, {
    headers: { Authorization: authorization || '' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success || !body.data) {
    const error = new Error(body.message || 'Unable to validate quotation');
    error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  return body.data;
};

const markQuotationPaid = async (quotationId, paymentData) => {
  const serviceToken = jwt.sign(
    { service: 'craftdelhi-main-backend' },
    process.env.JWT_SECRET,
    { expiresIn: '2m' }
  );

  const response = await fetch(`${getChatServiceUrl()}/quotations/${quotationId}/mark-paid`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Token': serviceToken
    },
    body: JSON.stringify(paymentData)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(body.message || 'Chat service did not confirm the paid quotation');
  }
  return body.data;
};

const getOrderChatSummary = (orderId, userId) => new Promise((resolve, reject) => {
  Order.getOrderChatSummary(orderId, userId, (error, summary) => {
    if (error) return reject(error);
    resolve(summary);
  });
});

// ✅ Create Razorpay Order
exports.createRazorpayOrder = async (req, res) => {
  const { amount, currency = 'INR', receipt, quotation_id } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({
      status: false,
      message: 'Valid amount is required'
    });
  }

  try {
    const keys = getRazorpayKeys();
    let effectiveAmount = Number(amount);

    if (quotation_id) {
      let quotation;
      try {
        quotation = await fetchQuotation(quotation_id, req.headers.authorization);
      } catch (quotationError) {
        return res.status(quotationError.statusCode || 502).json({
          status: false,
          message: quotationError.message
        });
      }
      if (String(quotation.customer?.userId) !== String(req.user?.id)) {
        return res.status(403).json({ status: false, message: 'This quotation does not belong to the authenticated buyer' });
      }
      if (quotation.status !== 'ACCEPTED') {
        return res.status(409).json({ status: false, message: `Quotation is not ready for payment (current state: ${quotation.status})` });
      }
      effectiveAmount = Number(quotation.amount);
    }

    const options = {
      amount: Math.round(effectiveAmount * 100), // convert INR to paise
      currency: currency,
      receipt: receipt || (quotation_id ? `quote_${String(quotation_id).slice(-24)}` : `rcpt_${Date.now()}`)
    };

    const razorpay = getRazorpayInstance();
    const razorpayOrder = await razorpay.orders.create(options);
    const order_id = razorpayOrder.id;
    const key_id = keys.key_id;

    return res.status(200).json({
      status: true,
      message: 'Razorpay order created successfully',
      data: {
        mode: keys.mode,
        key_id: key_id,
        order_id: order_id,
        amount: Math.round(effectiveAmount * 100),
        currency: currency,
        receipt: options.receipt
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
    orderDetails,
    quotation_id
  } = req.body;

  if (!userId) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      status: false,
      message: 'Missing required payment verification fields'
    });
  }

  const { key_secret } = getRazorpayKeys();

  const mockPaymentAllowed = (
    razorpay_signature === 'valid_mock_signature' &&
    process.env.ALLOW_MOCK_RAZORPAY === 'true' &&
    getRazorpayKeys().mode === 'test'
  );

  if (!key_secret && !mockPaymentAllowed) {
    return res.status(500).json({
      status: false,
      message: 'Razorpay Key Secret is not configured in server environment variables'
    });
  }

  try {
    // Generate HMAC SHA256 signature
    let isSignatureValid = false;
    if (mockPaymentAllowed) {
      isSignatureValid = true;
    } else {
      const hmac = crypto.createHmac('sha256', key_secret);
      hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const generatedSignature = hmac.digest('hex');
      isSignatureValid = generatedSignature === razorpay_signature;
    }

    if (!isSignatureValid) {
      return res.status(400).json({
        status: false,
        message: 'Invalid payment signature'
      });
    }

    // Handle quotation payment using the chat service as the source of truth.
    if (quotation_id) {
      let quotation;
      try {
        quotation = await fetchQuotation(quotation_id, req.headers.authorization);
      } catch (quotationError) {
        return res.status(quotationError.statusCode || 502).json({
          status: false,
          message: quotationError.message
        });
      }

      if (String(quotation.customer?.userId) !== String(userId)) {
        return res.status(403).json({ status: false, message: 'This quotation does not belong to the authenticated buyer' });
      }

      if (!['ACCEPTED', 'PAID'].includes(quotation.status)) {
        return res.status(409).json({ status: false, message: `Quotation must be accepted before payment (current state: ${quotation.status})` });
      }

      const shippingAddressId = Number(req.body.shipping_address_id || req.body.orderDetails?.shipping_address_id);
      if (!Number.isInteger(shippingAddressId) || shippingAddressId <= 0) {
        return res.status(400).json({ status: false, message: 'A valid shipping address is required' });
      }

      const totalAmount = Number(quotation.amount);
      const sellerId = Number(quotation.provider?.userId);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0 || !Number.isInteger(sellerId) || sellerId <= 0) {
        return res.status(422).json({ status: false, message: 'Quotation amount or seller is invalid' });
      }

      if (!mockPaymentAllowed) {
        try {
          const razorpayOrder = await getRazorpayInstance().orders.fetch(razorpay_order_id);
          const expectedAmountInPaise = Math.round(totalAmount * 100);
          if (Number(razorpayOrder.amount) !== expectedAmountInPaise || razorpayOrder.currency !== 'INR') {
            return res.status(400).json({ status: false, message: 'Paid amount does not match the accepted quotation' });
          }
        } catch (razorpayError) {
          console.error('Razorpay quotation order validation failed:', razorpayError);
          return res.status(502).json({ status: false, message: 'Unable to validate the Razorpay order amount' });
        }
      }

      const order_uid = `ORD${Date.now()}`;
      const payment_uid = razorpay_payment_id;

      Order.createPaidOrderIdempotently(
        userId,
        {
          order_uid,
          total_amount: totalAmount,
          order_status: 1, // Confirmed
          payment_status: 1, // Paid
          payment_type: 'Online',
          payment_method: 'Razorpay',
          payment_uid,
          razorpay_order_id,
          shipping_address_id: shippingAddressId,
          seller_id: sellerId,
          buyer_note: req.body.buyer_note || quotation.description || 'Quotation order payment'
        },
        async (err, orderResult) => {
          if (err) {
            console.error("Quotation Order Creation Error after Razorpay verification:", err);
            return res.status(500).json({ status: false, message: "Payment verified but failed to save quotation order" });
          }

          const orderId = orderResult.order_id;
          const finalOrderUid = orderResult.order_uid || order_uid;
          let orderRoomId = null;
          let orderChatPending = false;
          let orderSummary = null;

          try {
            orderSummary = await getOrderChatSummary(orderId, userId);
          } catch (summaryError) {
            console.error("Failed to build order chat summary:", summaryError.message);
          }

          const safeOrderSummary = orderSummary || {
            orderId,
            orderUid: finalOrderUid,
            buyer: 'Customer',
            amount: totalAmount,
            address: '',
            buyerNote: req.body.buyer_note || quotation.description || '',
            items: []
          };

          try {
            const chatData = await markQuotationPaid(quotation_id, {
              orderId,
              orderUid: finalOrderUid,
              razorpay_order_id,
              razorpay_payment_id,
              orderSummary: safeOrderSummary
            });
            orderRoomId = chatData?.orderRoomId || null;
          } catch (chatErr) {
            console.error("Failed to notify chat service:", chatErr.message);
            orderChatPending = true;
          }

          // Send real-time notification
          if (sellerId && !orderResult.existing) {
            sendNotification({
              userId: sellerId,
              title: "Quotation Paid & Order Created",
              message: `Order #${finalOrderUid} of ₹${totalAmount} paid via Razorpay.`,
              type: "ORDER_CREATED",
              referenceId: orderId
            }).catch(e => console.error(e));
          }

          return res.status(200).json({
            status: true,
            message: "Quotation payment verified successfully and order created",
            data: {
              orderId,
              orderUid: finalOrderUid,
              orderRoomId,
              orderSummary: safeOrderSummary,
              quotation_id,
              alreadyVerified: Boolean(orderResult.existing),
              orderChatPending
            }
          });
        }
      );
      return;
    }

    // Payment is verified. Now create order in local database for regular cart orders
    const { total_amount, shipping_address_id, items, buyer_note } = orderDetails || {};

    const parsedTotalAmount = Number(total_amount);
    if (!Number.isFinite(parsedTotalAmount) || parsedTotalAmount <= 0 || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: false,
        message: 'Invalid orderDetails format'
      });
    }

    if (!mockPaymentAllowed) {
      try {
        const razorpayOrder = await getRazorpayInstance().orders.fetch(razorpay_order_id);
        if (Number(razorpayOrder.amount) !== Math.round(parsedTotalAmount * 100) || razorpayOrder.currency !== 'INR') {
          return res.status(400).json({ status: false, message: 'Paid amount does not match the order total' });
        }
      } catch (razorpayError) {
        console.error('Razorpay cart order validation failed:', razorpayError);
        return res.status(502).json({ status: false, message: 'Unable to validate the Razorpay order amount' });
      }
    }

    const order_uid = `ORD${Date.now()}`;
    const payment_uid = razorpay_payment_id; // Razorpay payment ID as reference
    const seller_id = items[0]?.seller_id;

    Order.createPaidOrderIdempotently(
      userId,
      {
        order_uid,
        total_amount: parsedTotalAmount,
        order_status: 1, // Confirmed
        payment_status: 1, // Paid
        payment_type: 'Online',
        payment_method: 'Razorpay',
        payment_uid,
        razorpay_order_id,
        shipping_address_id,
        seller_id,
        buyer_note,
        items
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
        const finalOrderUid = orderResult.order_uid || order_uid;

        if (!orderResult.existing) {
          // Trigger settlement process using the Razorpay payout service (Currently ON HOLD via ENABLE_SETTLEMENT_PROCESS=false)
          settlementService.triggerSettlementIfOnline(orderId, seller_id, parsedTotalAmount, 1, 'Online');

          // 🔔 Send Real-time Socket & DB Notifications for Online Payment
          if (seller_id) {
            sendNotification({
              userId: seller_id,
              title: "Prepaid Order Received & Payment Verified",
              message: `Order #${finalOrderUid} of ₹${parsedTotalAmount} paid successfully via Razorpay (ID: ${razorpay_payment_id}).`,
              type: "PAYMENT_RECEIVED",
              referenceId: orderId
            }).catch(e => console.error("Seller Razorpay Notification Error:", e));
          }

          if (userId) {
            sendNotification({
              userId: userId,
              title: "Payment Successful",
              message: `Your payment of ₹${parsedTotalAmount} for order #${finalOrderUid} was verified successfully.`,
              type: "PAYMENT_RECEIVED",
              referenceId: orderId
            }).catch(e => console.error("Buyer Razorpay Notification Error:", e));
          }
        }

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
