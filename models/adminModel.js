const db = require('../config/db'); // adjust path to your MySQL connection
const {runQuery} = require('../utils/updateUtils');

exports.getDashboardStats = (callback) => {
  const sql = `
    SELECT 
    (SELECT COUNT(*) FROM users WHERE role IN (2, 3)) AS total_users,
    (SELECT COUNT(*) FROM users WHERE role = 2 AND user_status = 1) AS active_sellers,
    (SELECT COUNT(*) FROM users WHERE role = 3 AND user_status = 1) AS active_buyers,
    (SELECT COUNT(*) FROM products WHERE admin_approval = 0) AS pending_products;
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getTotalusers = (callback) => {
  const sql = `
    SELECT id AS user_id, account_trashed, first_name, last_name, role, user_status, email, phone_number
    FROM users
    WHERE role != 1
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);

    const roleMap = { 2: "seller", 3: "buyer" };

    const updatedResults = results.map(user => ({
      ...user,
      role: roleMap[user.role] || "unknown"
    }));

    callback(null, updatedResults);
  });
};



// adminModel.js
exports.getAllProductsForAdmin = (callback) => {
  const sql = `
    SELECT 
      p.id, 
      p.name AS product_name, 
      p.admin_approval, 
      p.main_image_url, 
      u.first_name, 
      u.last_name
    FROM products p
    LEFT JOIN users u ON p.seller_id = u.id
    ORDER BY p.created_at DESC
  `;
  db.query(sql, callback);
};

exports.getProductsStats = (callback) => {
  const sql = `
    SELECT 
    (SELECT COUNT(*) FROM products) AS total_products,
    (SELECT COUNT(*) FROM products WHERE admin_approval = 0) AS pending_products
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getUserEmail = (user_id,callback) => {
  const sql = `
    SELECT email,first_name,last_name from users where id =?
  `;

  db.query(sql,user_id, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getTotalProducts = (callback) => {
  const sql = `
    SELECT 
        p.*, 
        pc.name AS category_name
    FROM products p
    LEFT JOIN product_categories pc 
        ON pc.id = p.category_id
    ORDER BY p.created_at DESC;
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results);
  });
};


exports.updateProductApprovalStatus = (productId, status, callback) => {
  const sql = `UPDATE products SET admin_approval = ? WHERE id = ?`;
  db.query(sql, [status, productId], callback);
};

exports.getBuyerStats = (callback) => {
  const sql = `
    SELECT 
    (SELECT COUNT(*) FROM users WHERE role = 3) AS total_buyers,
    (SELECT COUNT(*) FROM users WHERE role = 3 AND user_status = 1 AND account_trashed = 0) AS active_buyers,
    (SELECT COUNT(*) FROM users WHERE role = 3 AND account_trashed = 1) AS trashed_accounts
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getAllBuyersForAdmin = (callback) => {
  const sql = `
    SELECT 
      u.id AS user_id, 
      u.first_name, 
      u.last_name,
      u.email, 
      u.phone_number, 
      u.date_of_birth,
      u.user_status,
      u.account_trashed,
      u.gender,
      ua.city,
      ua.street,
      ua.state,
      ua.country,
      ua.postal_code
    FROM users u
    LEFT JOIN user_addresses ua ON ua.user_id = u.id
    where u.role = 3
    ORDER BY u.created_at DESC
  `;
  db.query(sql, callback);
};
exports.updateBuyerStatus = (user_id, user_status, callback) => {
  user_status = Number(user_status); // ensure it's numeric
  let sql;
  let values;

  if (user_status === 0 || user_status === 1) {
    sql = `UPDATE users SET user_status = ? WHERE id = ?`;
    values = [user_status, user_id];
  } else if (user_status === 2) {
    sql = `UPDATE users SET user_status = 2, account_trashed = 1 WHERE id = ?`;
    values = [user_id];
  } else {
    return callback(new Error("Invalid user_status value"));
  }

  db.query(sql, values, callback);
};


exports.updateBuyerDetailsByAdmin = (user_id, data, callback) => {
  db.getConnection((err, connection) => {
    if (err) return callback(err);

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return callback(err);
      }

      const updatePromises = [];

      // 1️⃣ Update `users` table
      const userFields = [
        "first_name",
        "last_name",
        "email",
        "phone_number",
        "date_of_birth",
        "gender"
      ];
      const userUpdates = userFields.filter(f => data[f] !== undefined);
      if (userUpdates.length) {
        const sql = `UPDATE users SET ${userUpdates.map(f => `${f}=?`).join(", ")} WHERE id=? AND role=?`;
        updatePromises.push(
          runQuery(connection, sql, [...userUpdates.map(f => data[f]), user_id, process.env.Buyer_role_id])
        );
      }

      // 2️⃣ Update `user_addresses` table (buyer’s shipping info)
      const buyerShippingDetails = ["city", "street", "state", "country", "postal_code"];
      const buyerDetailsUpdates = buyerShippingDetails.filter(f => data[f] !== undefined);
      if (buyerDetailsUpdates.length) {
        const sql = `UPDATE user_addresses SET ${buyerDetailsUpdates.map(f => `${f}=?`).join(", ")} WHERE user_id=?`;
        updatePromises.push(
          runQuery(connection, sql, [...buyerDetailsUpdates.map(f => data[f]), user_id])
        );
      }

      // 🧠 If no updates, skip transaction
      if (updatePromises.length === 0) {
        connection.release();
        return callback(null, { success: false, message: "No valid fields to update" });
      }

      // ✅ Run all queries in a transaction
      Promise.all(updatePromises)
        .then(() => {
          connection.commit((err) => {
            if (err) return rollback(err);
            connection.release();
            callback(null, { success: true });
          });
        })
        .catch(rollback);

      // 🔁 Rollback function
      function rollback(error) {
        connection.rollback(() => {
          connection.release();
          callback(error);
        });
      }
    });
  });
};

exports.getSellerStats = (callback) => {
  const sql = `
    SELECT 
    (SELECT COUNT(*) FROM users WHERE role = 2) AS total_sellers,
    (SELECT COUNT(*) FROM users WHERE role = 2 AND user_status = 1 AND account_trashed = 0) AS active_sellers,
    (SELECT COUNT(*) FROM users WHERE role = 2 AND account_trashed = 1) AS trashed_seller_accounts
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getAllSellersForAdmin = (callback) => {
  const sql = `
    SELECT 
        u.id AS user_id, 
        u.first_name, 
        u.last_name,
        u.email, 
        u.phone_number, 
        u.date_of_birth, 
        u.gender,
        u.user_approval,
        u.user_status,
        sd.office_address,
        sd.home_address,
        sd.profile_image,
        ss.store_name,
        ss.seller_id AS store_id,
        ss.store_link,
        ss.description,
        COALESCE(ss.store_created_date, u.created_at, ss.created_at) AS store_created_date,
        ss.business_number,
        ss.store_image,
        bd.bank_name,
        bd.branch_location,
        bd.account_holder_name,
        bd.account_number,
        bd.ifsc_code 
    FROM users u
    LEFT JOIN seller_details sd 
        ON sd.user_id = u.id
    LEFT JOIN seller_stores ss 
        ON ss.seller_id = u.id
    LEFT JOIN users_bank_details bd 
        ON bd.user_id = u.id
    where u.role = 2    
    ORDER BY u.created_at DESC;
  `;
  db.query(sql, callback);
};

// adminModel.js
exports.updateSellerDetailsByAdmin = (user_id, data, callback) => {
  db.getConnection((err, connection) => {
    if (err) return callback(err);

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return callback(err);
      }

      const updatePromises = [];

      // 1️⃣ Update `users` table
      const userFields = [
        "first_name",
        "last_name",
        "email",
        "phone_number",
        "date_of_birth",
        "gender",
        "user_approval"
      ];
      const userUpdates = userFields.filter(f => data[f] !== undefined);
      if (userUpdates.length) {
        const sql = `UPDATE users SET ${userUpdates.map(f => `${f}=?`).join(", ")} WHERE id=? AND role=?`;
        updatePromises.push(runQuery(connection, sql, [...userUpdates.map(f => data[f]), user_id, process.env.Seller_role_id]));
      }

      // 2️⃣ Update `seller_details` table
      const detailsFields = ["office_address", "home_address", "profile_image"];
      const detailsUpdates = detailsFields.filter(f => data[f] !== undefined);
      if (detailsUpdates.length) {
        const sql = `UPDATE seller_details SET ${detailsUpdates.map(f => `${f}=?`).join(", ")} WHERE user_id=?`;
        updatePromises.push(runQuery(connection, sql, [...detailsUpdates.map(f => data[f]), user_id]));
      }

      // 3️⃣ Update `seller_stores` table
      const storeFields = [
        "store_name",
        "store_link",
        "description",
        "store_created_date",
        "business_number",
        "store_image"
      ];
      const storeUpdates = storeFields.filter(f => data[f] !== undefined);
      if (storeUpdates.length) {
        const sql = `UPDATE seller_stores SET ${storeUpdates.map(f => `${f}=?`).join(", ")} WHERE seller_id=?`;
        updatePromises.push(runQuery(connection, sql, [...storeUpdates.map(f => data[f]), user_id]));
      }

      // 4️⃣ Update `users_bank_details` table
      const bankFields = [
        "bank_name",
        "branch_location",
        "account_holder_name",
        "account_number",
        "ifsc_code"
      ];
      const bankUpdates = bankFields.filter(f => data[f] !== undefined);
      if (bankUpdates.length) {
        const sql = `UPDATE users_bank_details SET ${bankUpdates.map(f => `${f}=?`).join(", ")} WHERE user_id=?`;
        updatePromises.push(runQuery(connection, sql, [...bankUpdates.map(f => data[f]), user_id]));
      }

      if (updatePromises.length === 0) {
        connection.release();
        return callback(null, { success: false, message: "No valid fields to update" });
      }

      Promise.all(updatePromises)
        .then(() => {
          connection.commit((err) => {
            if (err) return rollback(err);
            connection.release();
            callback(null, { success: true });
          });
        })
        .catch(rollback);

      function rollback(error) {
        connection.rollback(() => {
          connection.release();
          callback(error);
        });
      }
    });
  });
};

exports.getSellerImages = (user_id, callback) => {
  const sql = `
    SELECT sd.profile_image, ss.store_image
    FROM users u
    JOIN seller_details sd ON sd.user_id = u.id
    JOIN seller_stores ss ON ss.seller_id = u.id
    WHERE u.id = ? AND u.role = ?
  `;
  db.query(sql, [user_id, process.env.Seller_role_id], (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.updateSellerApprovalStatus = (seller_id, status, callback) => {
  const sql = `UPDATE users SET user_approval = ? WHERE id = ?`;
  db.query(sql, [status, seller_id], callback);
};

exports.deleteSellerData = (seller_id, callback) => {
  const queries = [
    `DELETE FROM users_bank_details WHERE user_id = ?`,
    `DELETE FROM seller_stores WHERE seller_id = ?`,
    `DELETE FROM seller_details WHERE user_id = ?`,
    `DELETE FROM users WHERE id = ?`
  ];

  let index = 0;

  const runNext = () => {
    if (index >= queries.length) {
      return callback(null); // All queries done
    }

    db.query(queries[index], [seller_id], (err) => {
      if (err) return callback(err);
      index++;
      runNext();
    });
  };

  runNext();
};

exports.getOrderStats = (callback) => {
  const sql = `
    SELECT 
        (SELECT COUNT(*) FROM order_details) AS total_orders,
        (SELECT COUNT(*) FROM order_details WHERE order_status IN (0,1,2)) AS pending_orders,
        (SELECT COUNT(*) FROM order_details WHERE order_status = 3) AS completed_orders;
      `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getAllOrdersForAdmin = (callback) => {
  const sql = `
    SELECT 
      -- Order Details
      O.id AS order_id, O.order_uid, O.user_id, O.seller_id, O.total_amount,
      O.order_status, pm.id AS payment_id, pm.payment_uid, pm.payment_status,
      pm.payment_type, pm.payment_method, O.shipping_address_id,
      O.created_at AS order_created_at,

      -- Seller Details
      COALESCE(NULLIF(ss.store_name, ''), TRIM(CONCAT(su.first_name, ' ', su.last_name))) AS seller_name,

      -- Order Items
      OI.id AS item_id, OI.product_id, OI.quantity, OI.price AS item_price,

      -- Product Details
      P.name AS product_name, P.description AS product_description, P.price AS product_price,
      P.category_id, P.stock, P.dimension, P.package_weight, P.weight_type, 
      P.gallery_images, P.main_image_url, P.video_url, P.reel_url,

      -- Shipping Address
      UA.street, UA.city, UA.state, UA.country, UA.postal_code
    FROM order_details O
    LEFT JOIN order_items OI ON O.id = OI.order_id
    LEFT JOIN payments pm ON pm.order_id = O.id
    LEFT JOIN products P ON P.id = OI.product_id
    LEFT JOIN user_addresses UA ON UA.id = O.shipping_address_id
    LEFT JOIN users su ON su.id = O.seller_id
    LEFT JOIN seller_stores ss ON ss.seller_id = O.seller_id
    ORDER BY O.created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);

    const orders = {};

    results.forEach(row => {
      if (!orders[row.order_id]) {
        orders[row.order_id] = {
          id: row.order_id,
          order_uid: row.order_uid,
          user_id: row.user_id,
          seller_id: row.seller_id,
          seller_name: row.seller_name,
          total_amount: row.total_amount,
          order_status: row.order_status,
          payment_id: row.payment_id,
          payment_uid: row.payment_uid,
          payment_status: row.payment_status,
          payment_type: row.payment_type,
          payment_method: row.payment_method,
          shipping_address_id: row.shipping_address_id,
          created_at: row.order_created_at,

          // Shipping address
          shipping_address: {
            street: row.street,
            city: row.city,
            state: row.state,
            country: row.country,
            postal_code: row.postal_code
          },

          items: []
        };
      }

      if (row.item_id) {
        orders[row.order_id].items.push({
          item_id: row.item_id,
          product_id: row.product_id,
          quantity: row.quantity,
          price: row.item_price,

          product: {
            name: row.product_name,
            description: row.product_description,
            price: row.product_price,
            category_id: row.category_id,
            stock: row.stock,
            dimension: row.dimension,
            package_weight: row.package_weight,
            weight_type: row.weight_type,
            gallery_images: row.gallery_images,
            main_image_url: row.main_image_url,
            video_url: row.video_url,
            reel_url: row.reel_url
          }
        });
      }
    });

    callback(null, Object.values(orders));
  });
};


exports.updateOrderStatus = (order_id, updates, callback) => {
  db.getConnection((connectionError, connection) => {
    if (connectionError) return callback(connectionError);

    const finish = (error, result) => {
      connection.release();
      callback(error, result);
    };

    const rollback = (error) => {
      connection.rollback(() => finish(error));
    };

    connection.beginTransaction((transactionError) => {
      if (transactionError) return finish(transactionError);

      const operations = [];

      if (updates.order_status !== undefined) {
        operations.push((next) => {
          connection.query(
            'UPDATE order_details SET order_status = ? WHERE id = ?',
            [Number(updates.order_status), order_id],
            next
          );
        });
      }

      if (updates.payment_status !== undefined) {
        operations.push((next) => {
          connection.query(
            'UPDATE payments SET payment_status = ? WHERE order_id = ?',
            [Number(updates.payment_status), order_id],
            next
          );
        });
      }

      if (!operations.length) {
        return rollback(new Error('No valid order fields to update'));
      }

      let index = 0;
      const runNext = (error) => {
        if (error) return rollback(error);
        if (index < operations.length) {
          const operation = operations[index++];
          return operation(runNext);
        }

        connection.commit((commitError) => {
          if (commitError) return rollback(commitError);
          finish(null, { affectedRows: 1 });
        });
      };

      runNext();
    });
  });
};

exports.deleteOrderbyAdmin = (order_id, callback) => {
  // Step 1: Delete order items first
  const deleteItemsSql = `DELETE FROM order_items WHERE order_id = ?`;
  db.query(deleteItemsSql, [order_id], (err) => {
    if (err) return callback(err);

    // Step 2: Delete order
    const deleteOrderSql = `DELETE FROM order_details WHERE id = ?`;
    db.query(deleteOrderSql, [order_id], callback);
  });
};

exports.getRevenueStats = (callback) => {
  const sql = `
    SELECT 
      (SELECT SUM(total_amount) FROM order_details) AS total_revenue,
      (SELECT SUM(total_amount) 
       FROM order_details 
       WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
       AND YEAR(created_at) = YEAR(CURRENT_DATE())
      ) AS current_month_revenue
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err);
    callback(null, results[0]);
  });
};

exports.getSellerDetailsByProductID = (productId, callback) => {
  const sql = `
    SELECT u.id AS seller_id, u.email, u.first_name, u.last_name, p.name, p.name AS product_name
    FROM products p
    JOIN users u ON p.seller_id = u.id
    WHERE p.id = ?
  `;
  db.query(sql, [productId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0]);
  });
};


exports.getRevenueDetailsForAdmin = (year, month, callback) => {
  let sql = `
    SELECT 
      u.id AS seller_id,
      u.first_name,
      u.last_name,
      YEAR(od.created_at) AS year,
      SUM(od.total_amount) AS total_revenue
  `;

  // If month is provided, include it
  if (month) {
    sql += `,
      MONTH(od.created_at) AS month
    `;
  }

  sql += `
    FROM order_details od
    LEFT JOIN users u ON u.id = od.seller_id
    WHERE YEAR(od.created_at) = ?
  `;

  // Add month filter if specified
  const params = [year || new Date().getFullYear()];
  if (month) {
    sql += ` AND MONTH(od.created_at) = ?`;
    params.push(month);
  }

  // Grouping logic
  sql += month
    ? ` GROUP BY u.id, YEAR(od.created_at), MONTH(od.created_at)`
    : ` GROUP BY u.id, YEAR(od.created_at)`;

  sql += ` ORDER BY YEAR(od.created_at) DESC`;

  if (month) sql += `, MONTH(od.created_at) DESC`;

  db.query(sql, params, (err, results) => {
    if (err) return callback(err);

    const orders = results.map(row => ({
      seller_id: row.seller_id,
      seller_name: `${row.first_name} ${row.last_name}`,
      year: row.year,
      ...(month && { month: row.month }),
      total_revenue: row.total_revenue
    }));

    callback(null, orders);
  });
};

exports.createBanner = (data, callback) => {
  const {
    title,
    banner,
    type,
    status = 1,
    position = 0
  } = data;

  const query = `
    INSERT INTO banners (title, banner, type, status, position)
    VALUES (?, ?, ?, ?, ?)
  `;

  const values = [title, banner, type, status, position];

  db.query(query, values, (err, result) => {
    if (err) return callback(err, null);
    return callback(null, result);
  });
};

exports.updateBannerByID = (bannerId, data, callback) => {
  const fields = [];
  const values = [];

  // Dynamically build SET clause
  for (let key in data) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) {
    return callback(null, { affectedRows: 0 });
  }

  const sql = `
    UPDATE banners
    SET ${fields.join(', ')}
    WHERE id = ?
  `;

  values.push(bannerId);

  db.query(sql, values, (err, result) => {
    if (err) return callback(err, null);
    return callback(null, result);
  });
};

exports.getBannerByID = (bannerId, callback) => {
  const sql = `
    SELECT *
    FROM banners
    WHERE id = ?
    LIMIT 1
  `;

  db.query(sql, [bannerId], (err, results) => {
    if (err) return callback(err, null);

    if (results.length === 0) {
      return callback(null, null);
    }

    return callback(null, results[0]);
  });
};

exports.getActiveBanners = (callback) => {
  const sql = `
    SELECT *
    FROM banners
    ORDER BY position ASC
  `;

  db.query(sql, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.getAdminDetails = (user_id,callback) => {
  const sql = `
    SELECT *
    FROM users where id = ? and role = 1
  `;

  db.query(sql, user_id, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.deleteBannerByID = (bannerId, callback) => {
  const sql = `DELETE FROM banners WHERE id = ?`;

  db.query(sql, [bannerId], (err, result) => {
    if (err) return callback(err, null);
    return callback(null, result);
  });
};
