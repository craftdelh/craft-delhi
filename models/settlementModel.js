const db = require('../config/db');

// Create a new settlement record
exports.createSettlement = (data, callback) => {
  const {
    order_id,
    seller_id,
    total_amount,
    commission_percentage,
    commission_amount,
    settlement_amount,
    payout_status,
    razorpay_payout_id = null,
    razorpay_contact_id = null,
    razorpay_fund_account_id = null,
    failure_reason = null
  } = data;

  const query = `
    INSERT INTO settlements 
      (order_id, seller_id, total_amount, commission_percentage, commission_amount, settlement_amount, payout_status, razorpay_payout_id, razorpay_contact_id, razorpay_fund_account_id, failure_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [order_id, seller_id, total_amount, commission_percentage, commission_amount, settlement_amount, payout_status, razorpay_payout_id, razorpay_contact_id, razorpay_fund_account_id, failure_reason],
    (err, result) => {
      if (err) return callback(err, null);
      callback(null, result);
    }
  );
};

// Update an existing settlement record
exports.updateSettlement = (id, data, callback) => {
  const fields = [];
  const values = [];

  for (let key in data) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) return callback(null, { affectedRows: 0 });

  const sql = `UPDATE settlements SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  db.query(sql, values, (err, result) => {
    if (err) return callback(err, null);
    callback(null, result);
  });
};

// Get settlements for admin panel
exports.getSettlementsForAdmin = (callback) => {
  const query = `
    SELECT 
      s.*,
      od.order_uid,
      od.created_at AS order_date,
      u.first_name AS seller_first_name,
      u.last_name AS seller_last_name,
      u.email AS seller_email,
      ss.store_name
    FROM settlements s
    LEFT JOIN order_details od ON od.id = s.order_id
    LEFT JOIN users u ON u.id = s.seller_id
    LEFT JOIN seller_stores ss ON ss.seller_id = s.seller_id
    ORDER BY s.created_at DESC
  `;

  db.query(query, [], (err, results) => {
    if (err) return callback(err, null);
    callback(null, results);
  });
};

// Get settlements for a specific seller
exports.getSettlementsBySellerId = (sellerId, callback) => {
  const query = `
    SELECT 
      s.*,
      od.order_uid,
      od.created_at AS order_date
    FROM settlements s
    LEFT JOIN order_details od ON od.id = s.order_id
    WHERE s.seller_id = ?
    ORDER BY s.created_at DESC
  `;

  db.query(query, [sellerId], (err, results) => {
    if (err) return callback(err, null);
    callback(null, results);
  });
};
