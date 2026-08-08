const db = require('../config/db');
const https = require('https');
const Settlement = require('../models/settlementModel');

// Helper to make HTTPS requests to Razorpay API
const makeRazorpayRequest = (path, method, body = null) => {
  return new Promise((resolve, reject) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return reject(new Error('Razorpay Key ID or Secret not configured in environment variables'));
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      }
    };

    console.log(`[Razorpay API] Sending request ${method} https://api.razorpay.com${path}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            console.error(`[Razorpay API Error] Status ${res.statusCode}:`, parsedData);
            reject({
              statusCode: res.statusCode,
              error: parsedData.error ? parsedData.error.description || parsedData.error : parsedData
            });
          }
        } catch (e) {
          console.error(`[Razorpay API Parse Error] Status ${res.statusCode}:`, data);
          reject({
            statusCode: res.statusCode,
            error: data || e.message
          });
        }
      });
    });

    req.on('error', (e) => {
      console.error('[Razorpay API Connection Error]:', e);
      reject(e);
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
};

// Fetch seller information
const getSellerDetails = (sellerId) => {
  return new Promise((resolve, reject) => {
    const query = 'SELECT id, first_name, last_name, email, phone_number FROM users WHERE id = ?';
    db.query(query, [sellerId], (err, results) => {
      if (err) return reject(err);
      if (results.length === 0) return reject(new Error('Seller user not found'));
      resolve(results[0]);
    });
  });
};

// Fetch seller bank details
const getSellerBankDetails = (sellerId) => {
  return new Promise((resolve, reject) => {
    const query = 'SELECT * FROM users_bank_details WHERE user_id = ?';
    db.query(query, [sellerId], (err, results) => {
      if (err) return reject(err);
      if (results.length === 0) return resolve(null);
      resolve(results[0]);
    });
  });
};

// Update contact and fund IDs in users_bank_details
const updateSellerBankDetailsIds = (userId, contactId, fundAccountId) => {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    if (contactId) {
      fields.push('razorpay_contact_id = ?');
      values.push(contactId);
    }
    if (fundAccountId) {
      fields.push('razorpay_fund_account_id = ?');
      values.push(fundAccountId);
    }
    
    if (fields.length === 0) return resolve();

    const sql = `UPDATE users_bank_details SET ${fields.join(', ')} WHERE user_id = ?`;
    values.push(userId);

    db.query(sql, values, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
};

// Main settlement processing entrypoint
exports.processSettlement = async (orderId, sellerId, totalAmount) => {
  // Check if settlement process is enabled (currently ON HOLD)
  if (process.env.ENABLE_SETTLEMENT_PROCESS !== 'true') {
    console.log(`[Settlement Service] [ON HOLD] Razorpay settlement process is currently ON HOLD. Skipping settlement for Order #${orderId}`);
    return;
  }

  console.log(`[Settlement Service] Starting settlement for Order #${orderId}, Seller #${sellerId}, Amount: ${totalAmount}`);

  // 1. Calculate commission
  const commissionPercentage = parseFloat(process.env.SETTLEMENT_COMMISSION_PERCENTAGE || '10.00');
  const commissionAmount = parseFloat(((totalAmount * commissionPercentage) / 100).toFixed(2));
  const settlementAmount = parseFloat((totalAmount - commissionAmount).toFixed(2));

  let payoutStatus = 'pending';
  let failureReason = null;
  let razorpayPayoutId = null;
  let razorpayContactId = null;
  let razorpayFundAccountId = null;

  let seller = null;
  let bankDetails = null;

  try {
    // Fetch seller and bank details
    seller = await getSellerDetails(sellerId);
    bankDetails = await getSellerBankDetails(sellerId);

    if (!bankDetails || !bankDetails.account_number || !bankDetails.ifsc_code) {
      throw new Error('Seller bank details are incomplete or missing. Cannot process bank transfer.');
    }

    razorpayContactId = bankDetails.razorpay_contact_id;
    razorpayFundAccountId = bankDetails.razorpay_fund_account_id;

    // Check if real payouts are enabled
    const enableRealPayouts = process.env.ENABLE_REAL_PAYOUTS === 'true';

    if (!enableRealPayouts) {
      // --- SIMULATION MODE ---
      console.log(`[Settlement Service] [SIMULATION] Simulating Razorpay payout of INR ${settlementAmount} to account ${bankDetails.account_number}`);
      payoutStatus = 'completed';
      razorpayPayoutId = `pout_sim_${Date.now()}`;
      razorpayContactId = razorpayContactId || `cont_sim_${Date.now()}`;
      razorpayFundAccountId = razorpayFundAccountId || `fa_sim_${Date.now()}`;
      
      // Update cache in database for simulation
      await updateSellerBankDetailsIds(sellerId, razorpayContactId, razorpayFundAccountId);
    } else {
      // --- REAL RAZORPAYX PAYOUTS MODE ---
      if (!process.env.RAZORPAYX_ACCOUNT_NUMBER) {
        throw new Error('RAZORPAYX_ACCOUNT_NUMBER is not set in environment variables');
      }

      // Step A: Create Contact if not already present
      if (!razorpayContactId) {
        console.log(`[RazorpayX] Creating contact for Seller #${sellerId}`);
        const sellerName = `${seller.first_name || ''} ${seller.last_name || ''}`.trim() || `Seller ${seller.id}`;
        const contactBody = {
          name: sellerName,
          email: seller.email || `seller${seller.id}@craftdelhi.com`,
          contact: seller.phone_number ? seller.phone_number.replace(/[^0-9]/g, '').slice(-10) : '9999999999',
          type: 'vendor',
          reference_id: `seller_${sellerId}`
        };

        const contactRes = await makeRazorpayRequest('/v1/contacts', 'POST', contactBody);
        razorpayContactId = contactRes.id;
      }

      // Step B: Create Fund Account if not already present
      if (!razorpayFundAccountId) {
        console.log(`[RazorpayX] Creating fund account for Seller #${sellerId}`);
        const accountHolderName = bankDetails.account_holder_name || `${seller.first_name || ''} ${seller.last_name || ''}`.trim() || `Seller ${seller.id}`;
        const fundAccountBody = {
          contact_id: razorpayContactId,
          account_type: 'bank_account',
          bank_account: {
            name: accountHolderName,
            ifsc: bankDetails.ifsc_code,
            account_number: bankDetails.account_number
          }
        };

        const fundAccountRes = await makeRazorpayRequest('/v1/fund_accounts', 'POST', fundAccountBody);
        razorpayFundAccountId = fundAccountRes.id;
      }

      // Update contact & fund account IDs in DB
      await updateSellerBankDetailsIds(sellerId, razorpayContactId, razorpayFundAccountId);

      // Step C: Dispatch Payout
      console.log(`[RazorpayX] Dispatching payout of INR ${settlementAmount} to fund account ${razorpayFundAccountId}`);
      
      const payoutAmountPaise = Math.round(settlementAmount * 100);
      const merchantRefId = `setl_${orderId}_${Date.now()}`;

      const payoutBody = {
        account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
        fund_account_id: razorpayFundAccountId,
        amount: payoutAmountPaise,
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: merchantRefId
      };

      const payoutRes = await makeRazorpayRequest('/v1/payouts', 'POST', payoutBody);
      razorpayPayoutId = payoutRes.id;

      const resStatus = payoutRes.status; // e.g. processing, processed, queued, failed
      if (resStatus === 'processed') {
        payoutStatus = 'completed';
      } else if (resStatus === 'failed') {
        payoutStatus = 'failed';
        failureReason = payoutRes.status_details ? payoutRes.status_details.reason : 'Razorpay Payout failed';
      } else {
        payoutStatus = 'processing';
      }
    }
  } catch (error) {
    const errorMsg = error.error ? (typeof error.error === 'string' ? error.error : JSON.stringify(error.error)) : (error.message || JSON.stringify(error));
    console.error(`[Settlement Service Error] Failed to process settlement for Order #${orderId}:`, errorMsg);
    payoutStatus = 'failed';
    failureReason = errorMsg;
  }

  // 2. Create the settlement record in the database
  const settlementRecord = {
    order_id: orderId,
    seller_id: sellerId,
    total_amount: totalAmount,
    commission_percentage: commissionPercentage,
    commission_amount: commissionAmount,
    settlement_amount: settlementAmount,
    payout_status: payoutStatus,
    razorpay_payout_id: razorpayPayoutId,
    razorpay_contact_id: razorpayContactId,
    razorpay_fund_account_id: razorpayFundAccountId,
    failure_reason: failureReason
  };

  await new Promise((resolve) => {
    Settlement.createSettlement(settlementRecord, (err, result) => {
      if (err) {
        console.error(`[Settlement Service DB Error] Failed to save settlement record for Order #${orderId}:`, err);
      } else {
        console.log(`[Settlement Service] Settlement record saved successfully. ID: ${result.insertId}`);
      }
      resolve();
    });
  });
};

// Check if payment is paid and online, then trigger settlement
exports.triggerSettlementIfOnline = (orderId, sellerId, totalAmount, paymentStatus, paymentType) => {
  // Check if settlement process is enabled (currently ON HOLD)
  if (process.env.ENABLE_SETTLEMENT_PROCESS !== 'true') {
    console.log(`[Settlement Service] [ON HOLD] Razorpay settlement process is currently ON HOLD. Skipping settlement trigger for Order #${orderId}`);
    return;
  }

  // paymentStatus 1 = Paid
  // paymentType 'Online' = Online payment directly to Admin account
  const isPaid = Number(paymentStatus) === 1;
  const isOnline = paymentType === 'Online';

  if (isPaid && isOnline) {
    // Process asynchronously so we don't block the HTTP response
    setImmediate(() => {
      exports.processSettlement(orderId, sellerId, totalAmount);
    });
  } else {
    console.log(`[Settlement Service] Order #${orderId} does not qualify for auto-settlement (Paid: ${isPaid}, Online: ${isOnline})`);
  }
};
