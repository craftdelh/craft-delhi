const db = require('../config/db');

// ✅ Create Custom Order
exports.createCustomOrder = (data, callback) => {

  const sql = `
    INSERT INTO custom_orders (
      custom_order_uid,
      user_id,
      seller_id,
      customer_name,
      customer_phone,
      product_details,
      quantity,
      price,
      customize_description,
      shipping_address,
      buyer_note,
      order_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      data.custom_order_uid,
      data.user_id,
      data.seller_id,
      data.customer_name,
      data.customer_phone,
      data.product_details,
      data.quantity,
      data.price,
      data.customize_description,
      data.shipping_address,
      data.buyer_note,
      data.order_status
    ],
    (err, result) => {
      if (err) return callback(err);

      callback(null, {
        custom_order_id: result.insertId
      });
    }
  );
};

// ✅ Get All Orders By User
exports.getCustomOrdersByUser = (userId, callback) => {

  const sql = `
    SELECT *
    FROM custom_orders
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [userId], callback);

};

// ✅ Get All Orders By Seller
exports.getCustomOrdersBySeller = (sellerId, callback) => {

  const sql = `
    SELECT *
    FROM custom_orders
    WHERE seller_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [sellerId], callback);

};

// ✅ Get Single Order
exports.getCustomOrderById = (orderId, callback) => {

  const sql = `
    SELECT *
    FROM custom_orders
    WHERE id = ?
  `;

  db.query(sql, [orderId], (err, results) => {

    if (err) return callback(err);

    callback(null, results[0]);

  });

};

// ✅ Update Order
exports.updateCustomOrder = (orderId, data, callback) => {

  if (!data || Object.keys(data).length === 0) {
    return callback(new Error('No fields provided'));
  }

  const allowedFields = [
    'customer_name',
    'customer_phone',
    'product_details',
    'quantity',
    'price',
    'customize_description',
    'shipping_address',
    'buyer_note',
    'order_status'
  ];

  const filteredData = Object.keys(data)
    .filter(key => allowedFields.includes(key))
    .reduce((obj, key) => {
      obj[key] = data[key];
      return obj;
    }, {});

  if (Object.keys(filteredData).length === 0) {
    return callback(new Error('No valid fields to update'));
  }

  const fields = Object.keys(filteredData)
    .map(key => `${key} = ?`)
    .join(', ');

  const values = Object.values(filteredData);

  const sql = `
    UPDATE custom_orders
    SET ${fields}
    WHERE id = ?
  `;

  db.query(sql, [...values, orderId], callback);

};

// ✅ Delete Order
exports.deleteCustomOrder = (orderId, callback) => {

  const sql = `
    DELETE FROM custom_orders
    WHERE id = ?
  `;

  db.query(sql, [orderId], callback);

};

// ✅ Verify Ownership
exports.getCustomOrderForVerification = (orderId, callback) => {

  const sql = `
    SELECT id, user_id, seller_id
    FROM custom_orders
    WHERE id = ?
  `;

  db.query(sql, [orderId], (err, results) => {

    if (err) return callback(err);

    callback(null, results[0]);

  });

};