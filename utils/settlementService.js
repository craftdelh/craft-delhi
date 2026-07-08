const db = require('../config/db');
const https = require('https');
const Settlement = require('../models/settlementModel');

// Helper to make HTTPS requests to Razorpay API
const makeRazorpayRequest = (path, method, body = null) => {
  return new Promise((resolve, reject) => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return reject(new Error('Razorpay API keys not configured in environment'));
    }

    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    
    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    };

    console.log(`[RazorpayX API] Sending request ${method} ${path}`);

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
            console.error(`[RazorpayX API Error] Status ${res.statusCode}:`, parsedData);
            reject({
              statusCode: res.statusCode,
              error: parsedData.error || parsedData
            });
          }
        } catch (e) {
          console.error(`[RazorpayX API Parse Error] Status ${res.statusCode}:`, data);
          reject({
            statusCode: res.statusCode,
            error: data || e.message
          });
        }
      });
    });

    req.on('error', (e) => {
      console.error('[RazorpayX API Connection Error]:', e);
      reject(e);
    });

    if (body) {
      req.write(JSON.stringify(body));
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

// Find existing contact in Razorpay by reference_id if creation fails
const findExistingContact = async (sellerId) => {
  try {
    const response = await makeRazorpayRequest(`/v1/contacts?reference_id=${sellerId}`, 'GET');
    if (response && response.items && response.items.length > 0) {
      return response.items[0];
    }
    return null;
  } catch (error) {
    console.error(`[RazorpayX] Failed to find existing contact for seller ${sellerId}:`, error);
    return null;
  }
};

// Get or Create RazorpayX Contact
const getOrCreateContact = async (seller) => {
  try {
    console.log(`[RazorpayX] Creating contact for seller: ${seller.first_name} ${seller.last_name}`);
    const body = {
      name: `${seller.first_name} ${seller.last_name}`.trim() || `Seller ${seller.id}`,
      email: seller.email || `seller${seller.id}@craftdelhi.com`,
      contact: seller.phone_number ? seller.phone_number.replace(/[^0-9]/g, '').slice(-10) : '9999999999',
      type: 'vendor',
      reference_id: String(seller.id)
    };
    const response = await makeRazorpayRequest('/v1/contacts', 'POST', body);
    return response;
  } catch (error) {
    // If contact already exists, search for it
    if (error.statusCode === 400 || (error.error && error.error.description && error.error.description.includes('already exists'))) {
      console.log(`[RazorpayX] Contact already exists for seller ${seller.id}. Searching...`);
      const existing = await findExistingContact(seller.id);
      if (existing) return existing;
    }
    throw error;
  }
};

// Get or Create RazorpayX Fund Account
const getOrCreateFundAccount = async (contactId, bankDetails) => {
  console.log(`[RazorpayX] Creating fund account for contact ${contactId}`);
  const body = {
    contact_id: contactId,
    account_type: 'bank_account',
    bank_account: {
      name: bankDetails.account_holder_name || 'Seller Account',
      ifsc: bankDetails.ifsc_code,
      account_number: bankDetails.account_number
    }
  };
  const response = await makeRazorpayRequest('/v1/fund_accounts', 'POST', body);
  return response;
};

// Main settlement processing entrypoint
exports.processSettlement = async (orderId, sellerId, totalAmount) => {
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
      console.log(`[Settlement Service] [SIMULATION] Simulating payout of INR ${settlementAmount} to account ${bankDetails.account_number}`);
      payoutStatus = 'completed';
      razorpayPayoutId = `pout_sim_${Date.now()}`;
      razorpayContactId = razorpayContactId || `cont_sim_${Date.now()}`;
      razorpayFundAccountId = razorpayFundAccountId || `fa_sim_${Date.now()}`;
      
      // Update cache in database for simulation
      await updateSellerBankDetailsIds(sellerId, razorpayContactId, razorpayFundAccountId);
    } else {
      // --- REAL RAZORPAYX MODE ---
      if (!process.env.RAZORPAYX_ACCOUNT_NUMBER) {
        throw new Error('RAZORPAYX_ACCOUNT_NUMBER is not set in environment variables');
      }

      // Step A: Contact
      if (!razorpayContactId) {
        const contact = await getOrCreateContact(seller);
        razorpayContactId = contact.id;
        await updateSellerBankDetailsIds(sellerId, razorpayContactId, null);
      }

      // Step B: Fund Account
      if (!razorpayFundAccountId) {
        const fundAccount = await getOrCreateFundAccount(razorpayContactId, bankDetails);
        razorpayFundAccountId = fundAccount.id;
        await updateSellerBankDetailsIds(sellerId, null, razorpayFundAccountId);
      }

      // Step C: Payout
      console.log(`[RazorpayX] Dispatching payout of INR ${settlementAmount} to fund account ${razorpayFundAccountId}`);
      const payoutBody = {
        account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
        fund_account_id: razorpayFundAccountId,
        amount: Math.round(settlementAmount * 100), // in paise
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'vendor bill',
        queue_if_low_balance: true,
        reference_id: String(orderId)
      };

      const payout = await makeRazorpayRequest('/v1/payouts', 'POST', payoutBody);
      razorpayPayoutId = payout.id;
      // Map Razorpay payout status to our internal status
      if (payout.status === 'processing' || payout.status === 'processed') {
        payoutStatus = 'completed';
      } else if (payout.status === 'reversed' || payout.status === 'failed') {
        payoutStatus = 'failed';
        failureReason = payout.failure_reason || `Razorpay status: ${payout.status}`;
      } else {
        payoutStatus = 'processing';
      }
    }
  } catch (error) {
    console.error(`[Settlement Service Error] Failed to process settlement for Order #${orderId}:`, error.message || error);
    payoutStatus = 'failed';
    failureReason = error.message || JSON.stringify(error);
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

  Settlement.createSettlement(settlementRecord, (err, result) => {
    if (err) {
      console.error(`[Settlement Service DB Error] Failed to save settlement record for Order #${orderId}:`, err);
    } else {
      console.log(`[Settlement Service] Settlement record saved successfully. ID: ${result.insertId}`);
    }
  });
};

// Check if payment is paid and online, then trigger settlement
exports.triggerSettlementIfOnline = (orderId, sellerId, totalAmount, paymentStatus, paymentType) => {
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
