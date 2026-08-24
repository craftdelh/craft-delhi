const db = require('../config/db');
const Payment = require('./paymentModel');
// ✅ Create a new order
exports.createOrder = (userId, data, callback) => {
  const {
    order_uid,
    total_amount,
    order_status,
    payment_status,  // numeric: 0, 1, 2, or 4
    payment_type,
    payment_method,
    payment_uid,
    razorpay_order_id,
    shipping_address_id,
    seller_id,
    buyer_note,
  } = data;

  const status = Number(order_status);

  const orderQuery = `
    INSERT INTO order_details 
      (order_uid, user_id, total_amount, order_status, shipping_address_id, seller_id, buyer_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  console.log('Inserting Order:', [order_uid, userId, total_amount, status]);

  db.query(
    orderQuery,
    [order_uid, userId, total_amount, status, shipping_address_id, seller_id, buyer_note],
    (err, orderResult) => {
      if (err) return callback(err, null);

      const orderId = orderResult.insertId;

      // Call payment model instead of direct query
      Payment.createPayment(
        orderId,
        { payment_uid, razorpay_order_id, payment_type, payment_status, payment_method },
        (paymentErr, paymentResult) => {
          if (paymentErr) return callback(paymentErr, null);

          callback(null, {
            message: "Order and payment created successfully",
            order_id: orderId,
            payment_id: paymentResult.insertId,
          });
        }
      );
    }
  );
};

// ✅ Insert multiple order items
exports.createOrderItems = (orderId, items, callback) => {
  if (!Array.isArray(items) || items.length === 0) {
    return callback(null, { affectedRows: 0 }); // No items to insert
  }

  const values = items.map(item => [
    orderId,
    item.product_id,
    item.quantity,
    item.price,
    item.quantity * item.price // calculate subtotal
  ]);

  const query = `
    INSERT INTO order_items (order_id, product_id, quantity, price, subtotal)
    VALUES ?
  `;

  db.query(query, [values], (err, result) => {
    if (err) return callback(err, null);
    callback(null, result);
  });
};

// ✅ Get order with items
exports.getOrderById = (orderId, userId, callback) => {
  const query = `
    SELECT 
      od.id AS order_id,
      od.order_uid,
      od.user_id,
      od.total_amount,
      od.order_status,
      od.shipping_address_id,
      od.buyer_note,
      od.created_at,
      oi.id AS item_id,
      oi.product_id,
      oi.quantity,
      oi.price,
      oi.subtotal,
      pay.payment_uid,
      pay.payment_type,
      pay.payment_status,
      pay.payment_method
    FROM order_details od
    LEFT JOIN order_items oi ON oi.order_id = od.id
    LEFT JOIN payments pay ON pay.order_id = od.id
    WHERE od.id = ? AND od.user_id = ?
  `;

  db.query(query, [orderId, userId], (err, results) => {
    if (err) return callback(err, null);

    if (!results.length) return callback(null, null); // no order found

    const order = {
      order_id: results[0].order_id,
      order_uid: results[0].order_uid,
      user_id: results[0].user_id,
      total_amount: results[0].total_amount,
      order_status: results[0].order_status,
      payment_status: results[0].payment_status,
      payment_method: results[0].payment_method,
      payment_uid: results[0].payment_uid,
      payment_type: results[0].payment_type,
      shipping_address_id: results[0].shipping_address_id,
      buyer_note: results[0].buyer_note,
      created_at: results[0].created_at,
      items: results.map(r => ({
        item_id: r.item_id,
        product_id: r.product_id,
        quantity: r.quantity,
        price: r.price,
        subtotal: r.subtotal
      }))
    };

    callback(null, order);
  });
};

exports.getrecentOrdersbySellerID = (sellerId, callback) => {
  const query = `
    SELECT 
      od.id AS order_id,
      od.order_uid,
      od.user_id,
      od.total_amount,
      od.order_status,
      pay.payment_uid,
      pay.payment_type,
      pay.payment_status,
      pay.payment_method,
      od.shipping_address_id,
      od.buyer_note,
      od.seller_id,
      od.created_at,
      oi.id AS item_id,
      oi.product_id,
      oi.quantity,
      oi.price,
      oi.subtotal,
      u.first_name,
      u.last_name,
      u.email,
      u.phone_number,
      p.name AS product_name,
      ua.street,
      ua.city,
      ua.state,
      ua.country,
      ua.postal_code,
      -- 🟢 Tracking columns
      ot.id AS tracking_id,
      ot.tracking_company,
      ot.tracking_number,
      ot.tracking_link,
      ot.estimated_delivery_from,
      ot.estimated_delivery_to,
      ot.status AS tracking_status
    FROM order_details od
    LEFT JOIN order_items oi ON oi.order_id = od.id
    LEFT JOIN users u ON u.id = od.user_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN user_addresses ua ON ua.id = od.shipping_address_id
    LEFT JOIN payments pay ON pay.order_id = od.id
    LEFT JOIN order_tracking ot ON ot.order_id = od.id
    WHERE od.seller_id = ?
    ORDER BY od.created_at DESC
  `;

  db.query(query, [sellerId], (err, results) => {
    if (err) return callback(err, null);
    if (!results.length) return callback(null, []);

    const ordersMap = {};

    results.forEach(row => {
      if (!ordersMap[row.order_id]) {
        const hasTracking = !!row.tracking_id;

        const orderData = {
          order_id: row.order_id,
          order_uid: row.order_uid,
          user_id: row.user_id,
          buyer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          phone_number: row.phone_number,
          email: row.email,
          total_amount: row.total_amount,
          order_status: row.order_status,
          payment_status: row.payment_status,
          payment_method: row.payment_method,
          payment_uid: row.payment_uid,
          payment_type: row.payment_type,
          shipping_address_id: row.shipping_address_id,
          shipping_info: `${row.street || ''} ${row.city || ''} ${row.state || ''} ${row.country || ''} ${row.postal_code || ''}`.trim(),
          buyer_note: row.buyer_note,
          seller_id: row.seller_id,
          created_at: row.created_at,
          items: [],
          tracking_info: hasTracking
        };

        // 🟢 Only add tracking_details when exists
        if (hasTracking) {
          orderData.tracking_details = {
            tracking_id: row.tracking_id,
            tracking_company: row.tracking_company,
            tracking_number: row.tracking_number,
            tracking_link: row.tracking_link,
            estimated_delivery_from: row.estimated_delivery_from,
            estimated_delivery_to: row.estimated_delivery_to,
            tracking_status: row.tracking_status
          };
        }

        ordersMap[row.order_id] = orderData;
      }

      if (row.item_id) {
        ordersMap[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          product_name: row.product_name,
          quantity: row.quantity,
          price: row.price,
          subtotal: row.subtotal
        });
      }
    });

    const orders = Object.values(ordersMap);
    callback(null, orders);
  });
};


exports.getOrderByIDforVerification = (order_id, callback) => {
  const sql = `SELECT id, seller_id, user_id FROM order_details WHERE id = ?`;
  db.query(sql, [order_id], (err, results) => {
    if (err) return callback(err, null);
    callback(null, results[0] || null);
  });
};

exports.updateOrderByID = (order_id, data, callback) => {
  if (!order_id || !data || Object.keys(data).length === 0) {
    return callback(new Error('Invalid update data or order_id'), null);
  }

  // 🧱 Whitelisted fields that can be updated
  const allowedFields = [
    'order_status',
    'total_amount',
    'buyer_note',
    'shipping_address_id',
    'cancel_reason'
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

  const sql = `UPDATE order_details SET ${fields} WHERE id = ?`;

  db.query(sql, [...values, order_id], (err, result) => {
    if (err) {
      console.error('Error executing order update query:', err);
      return callback(err, null);
    }
    callback(null, result);
  });
};

exports.getOrdersbyUserID = (user_id, callback) => {
  const query = `
    SELECT 
      od.id AS order_id,
      od.order_uid,
      od.user_id,
      od.total_amount,
      od.order_status,
      pay.payment_uid,
      pay.payment_type,
      pay.payment_status,
      pay.payment_method,
      od.shipping_address_id,
      od.buyer_note,
      od.created_at,
      oi.id AS item_id,
      oi.product_id,
      oi.quantity,
      oi.price,
      oi.subtotal,
      u.first_name,
      u.last_name,
      u.email,
      u.phone_number,
      p.name AS product_name,
      p.product_sku,
      p.main_image_url,
      ua.street,
      ua.city,
      ua.state,
      ua.country,
      ua.postal_code,
      -- 🟢 Tracking columns
      ot.id AS tracking_id,
      ot.tracking_company,
      ot.tracking_number,
      ot.tracking_link,
      ot.estimated_delivery_from,
      ot.estimated_delivery_to,
      ot.status AS tracking_status
    FROM order_details od
    LEFT JOIN order_items oi ON oi.order_id = od.id
    LEFT JOIN users u ON u.id = od.user_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN user_addresses ua ON ua.id = od.shipping_address_id
    LEFT JOIN payments pay ON pay.order_id = od.id
    LEFT JOIN order_tracking ot ON ot.order_id = od.id
    WHERE od.user_id = ?
    ORDER BY od.created_at DESC
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) return callback(err, null);
    if (!results.length) return callback(null, []);

    const ordersMap = {};

    results.forEach(row => {
      if (!ordersMap[row.order_id]) {
        const hasTracking = !!row.tracking_id;

        const orderData = {
          order_id: row.order_id,
          order_uid: row.order_uid,
          user_id: row.user_id,
          buyer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          phone_number: row.phone_number,
          email: row.email,
          total_amount: row.total_amount,
          order_status: row.order_status,
          payment_status: row.payment_status,
          payment_method: row.payment_method,
          payment_uid: row.payment_uid,
          payment_type: row.payment_type,
          shipping_address_id: row.shipping_address_id,
          shipping_info: `${row.street || ''} ${row.city || ''} ${row.state || ''} ${row.country || ''} ${row.postal_code || ''}`.trim(),
          buyer_note: row.buyer_note,
          created_at: row.created_at,
          items: [],
          tracking_info: hasTracking
        };

        // 🟢 Only add tracking_details when exists
        if (hasTracking) {
          orderData.tracking_details = {
            tracking_id: row.tracking_id,
            tracking_company: row.tracking_company,
            tracking_number: row.tracking_number,
            tracking_link: row.tracking_link,
            estimated_delivery_from: row.estimated_delivery_from,
            estimated_delivery_to: row.estimated_delivery_to,
            tracking_status: row.tracking_status
          };
        }

        ordersMap[row.order_id] = orderData;
      }

      if (row.item_id) {
        ordersMap[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          product_sku: row.product_sku,
          main_image_url: row.main_image_url,
          product_name: row.product_name,
          quantity: row.quantity,
          price: row.price,
          subtotal: row.subtotal
        });
      }
    });

    const orders = Object.values(ordersMap);
    callback(null, orders);
  });
};

exports.getOrdersInvoiceById = (order_id, callback) => {
  const query = `
    SELECT 
      od.id AS order_id,
      od.order_uid,
      od.user_id,
      od.total_amount,
      od.order_status,
      pay.payment_uid,
      pay.payment_type,
      pay.payment_status,
      pay.payment_method,
      od.shipping_address_id,
      od.buyer_note,
      od.created_at,
      oi.id AS item_id,
      oi.product_id,
      oi.quantity,
      oi.price,
      oi.subtotal,
      u.first_name,
      u.last_name,
      u.email,
      u.phone_number,
      p.name AS product_name,
      p.main_image_url,
      ua.street,
      ua.city,
      ua.state,
      ua.country,
      ua.postal_code,
      -- 🟢 Tracking columns
      ot.id AS tracking_id,
      ot.tracking_company,
      ot.tracking_number,
      ot.tracking_link,
      ot.estimated_delivery_from,
      ot.estimated_delivery_to,
      ot.status AS tracking_status,
      -- 🟢 Seller/Store Details
      od.seller_id,
      ss.store_name AS seller_store_name,
      ss.business_number AS seller_business_number,
      sd.office_address AS seller_office_address,
      sd.home_address AS seller_home_address,
      sd.city AS seller_city,
      su.email AS seller_email,
      su.phone_number AS seller_phone_number,
      su.first_name AS seller_first_name,
      su.last_name AS seller_last_name
    FROM order_details od
    LEFT JOIN order_items oi ON oi.order_id = od.id
    LEFT JOIN users u ON u.id = od.user_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN user_addresses ua ON ua.id = od.shipping_address_id
    LEFT JOIN payments pay ON pay.order_id = od.id
    LEFT JOIN order_tracking ot ON ot.order_id = od.id
    -- 🟢 Joins for Seller
    LEFT JOIN users su ON su.id = od.seller_id
    LEFT JOIN seller_stores ss ON ss.seller_id = od.seller_id
    LEFT JOIN seller_details sd ON sd.user_id = od.seller_id
    WHERE od.id = ?
    ORDER BY od.created_at DESC
  `;

  db.query(query, [order_id], (err, results) => {
    if (err) return callback(err, null);
    if (!results.length) return callback(null, []);

    const ordersMap = {};

    results.forEach(row => {
      if (!ordersMap[row.order_id]) {
        const hasTracking = !!row.tracking_id;

        const orderData = {
          order_id: row.order_id,
          order_uid: row.order_uid,
          user_id: row.user_id,
          buyer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          phone_number: row.phone_number,
          email: row.email,
          total_amount: row.total_amount,
          order_status: row.order_status,
          payment_status: row.payment_status,
          payment_method: row.payment_method,
          payment_uid: row.payment_uid,
          payment_type: row.payment_type,
          shipping_address_id: row.shipping_address_id,
          shipping_info: `${row.street || ''} ${row.city || ''} ${row.state || ''} ${row.country || ''} ${row.postal_code || ''}`.trim(),
          buyer_note: row.buyer_note,
          created_at: row.created_at,
          items: [],
          tracking_info: hasTracking,
          // 🟢 Seller store details
          seller_id: row.seller_id,
          seller_store_name: row.seller_store_name,
          seller_business_number: row.seller_business_number,
          seller_office_address: row.seller_office_address,
          seller_home_address: row.seller_home_address,
          seller_city: row.seller_city,
          seller_email: row.seller_email,
          seller_phone_number: row.seller_phone_number,
          seller_name: `${row.seller_first_name || ''} ${row.seller_last_name || ''}`.trim()
        };

        // 🟢 Only add tracking_details when exists
        if (hasTracking) {
          orderData.tracking_details = {
            tracking_id: row.tracking_id,
            tracking_company: row.tracking_company,
            tracking_number: row.tracking_number,
            tracking_link: row.tracking_link,
            estimated_delivery_from: row.estimated_delivery_from,
            estimated_delivery_to: row.estimated_delivery_to,
            tracking_status: row.tracking_status
          };
        }

        ordersMap[row.order_id] = orderData;
      }

      if (row.item_id) {
        ordersMap[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          main_image_url: row.main_image_url,
          product_name: row.product_name,
          quantity: row.quantity,
          price: row.price,
          subtotal: row.subtotal
        });
      }
    });

    const orders = Object.values(ordersMap);
    callback(null, orders);
  });
};