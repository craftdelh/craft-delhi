// models/payment.model.js
const db = require("../config/db");

exports.createPayment = (orderId, paymentData, callback) => {
  const { payment_uid, razorpay_order_id, payment_type, payment_status, payment_method } = paymentData;

  const status = Number(payment_status);

  const paymentQuery = `
    INSERT INTO payments 
      (order_id, payment_uid, razorpay_order_id, payment_type, payment_status, payment_method)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  console.log('Inserting Payment:', [orderId, payment_uid, razorpay_order_id, status]);

  db.query(
    paymentQuery,
    [orderId, payment_uid, razorpay_order_id, payment_type, status, payment_method],
    (err, result) => {
      if (err) return callback(err, null);
      callback(null, result);
    }
  );
};

exports.getPaymentSummary = (sellerId, callback) => {
  const sql = `
    SELECT 
      SUM(od.total_amount) AS total_revenue,
      SUM(CASE WHEN p.payment_status = 0 THEN od.total_amount ELSE 0 END) AS pending_amount,
      SUM(CASE WHEN p.payment_status = 2 THEN od.total_amount ELSE 0 END) AS refunded_amount
    FROM order_details od
    LEFT JOIN payments p ON od.id = p.order_id
    WHERE od.seller_id = ?;
      `;

  db.query(sql, [sellerId], (err, results) => {  // ✅ fix here
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getpaymentHistorybySellerID = (sellerId, callback) => {
  const query = `
    SELECT 
      pay.payment_uid,
      pay.payment_type,
      pay.payment_status,
      pay.payment_method,
      od.id AS order_id,
      od.order_uid,
      od.order_status,
      od.total_amount,
      od.buyer_note,
      p.name AS product_name,
      p.product_sku,
      oi.id AS item_id,
      oi.product_id,
      oi.quantity,
      oi.price,
      u.first_name,
      u.last_name,
      u.email,
      u.phone_number,
      ua.city,
      ua.street,
      ua.state,
      ua.country,
      ua.postal_code,
      od.created_at
    FROM order_details od
    LEFT JOIN order_items oi ON oi.order_id = od.id
    LEFT JOIN users u ON u.id = od.user_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN user_addresses ua ON ua.id = od.shipping_address_id
    LEFT JOIN payments pay ON pay.order_id = od.id
    WHERE od.seller_id = ?
    ORDER BY od.created_at DESC
  `;

  db.query(query, [sellerId], (err, results) => {
    if (err) return callback(err, null);
    if (!results.length) return callback(null, []);

    const ordersMap = {};

    results.forEach(row => {
      if (!ordersMap[row.order_id]) {
        ordersMap[row.order_id] = {
          order_id: row.order_id,
          order_uid: row.order_uid,
          order_status: row.order_status,
          total_amount: row.total_amount,
          payment_uid: row.payment_uid,
          payment_type: row.payment_type,
          payment_status: row.payment_status,
          payment_method: row.payment_method,
          buyer_note: row.buyer_note,
          buyer_info: {
            name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
            email: row.email,
            phone_number: row.phone_number
          },
          shipping_address: {
            street: row.street,
            city: row.city,
            state: row.state,
            country: row.country,
            postal_code: row.postal_code
          },
          created_at: row.created_at,
          items: []
        };
      }

      if (row.item_id) {
        ordersMap[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          product_name: row.product_name,
          product_sku: row.product_sku,
          quantity: row.quantity,
          price: row.price
        });
      }
    });

    const orders = Object.values(ordersMap);
    callback(null, orders);
  });
};

exports.updatePaymentByOrderID = (order_id, data, callback) => {
  if (!order_id || !data || Object.keys(data).length === 0) {
    return callback(new Error('Invalid update data or order_id'), null);
  }

  // 🧱 Whitelisted fields that can be updated
  const allowedFields = [
    'payment_status',
    'payment_method',
    'payment_type',
  ];

  // 🧩 Filter only allowed keys
  const filteredData = Object.keys(data)
    .filter(key => allowedFields.includes(key))
    .reduce((obj, key) => {
      obj[key] = data[key];
      return obj;
    }, {});

  if (Object.keys(filteredData).length === 0) {
    return callback(new Error('No valid fields to update'), null);
  }

  // 🔧 Build dynamic SQL query
  const fields = Object.keys(filteredData).map(key => `${key} = ?`).join(', ');
  const values = Object.values(filteredData);

  const sql = `UPDATE payments SET ${fields} WHERE order_id = ?`;

  db.query(sql, [...values, order_id], (err, result) => {
    if (err) {
      console.error('Error executing order update query:', err);
      return callback(err, null);
    }
    callback(null, result);
  });
};