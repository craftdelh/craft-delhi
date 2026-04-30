const db = require('../config/db');

exports.insert = (data) => {
  return new Promise((resolve, reject) => {
    const query = 'INSERT INTO products SET ?';
    db.query(query, data, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.getallProducts = (userId, callback) => {
  const sql = `
    SELECT 
      p.id,
      p.seller_id AS storeId,
      p.name,
      p.product_sku,
      p.description,
      p.category_id,
      pc.name AS category_name,
      p.stock,
      p.dimension,
      p.package_weight,
      p.warranty_type,
      p.gallery_images,
      p.video_url,
      p.reel_url,
      p.reel_name,
      p.video_name,
      p.hashtags,
      p.created_at,
      p.main_image_url,
      p.price, 
      s.store_name,
      s.store_username,

      -- favourite flag
      CASE 
        WHEN fp.id IS NOT NULL THEN TRUE 
        ELSE FALSE 
      END AS is_favourite,

      -- review count
      COALESCE(r.total_review, 0) AS total_review,

      -- average rating (out of 5)
      COALESCE(r.avg_rating, 0) AS average_rating,

      -- order count
      COALESCE(o.total_order, 0) AS total_order

    FROM products p

    LEFT JOIN favourites_product fp 
      ON p.id = fp.product_id 
      AND fp.user_id = ?

    -- reviews count + average rating
    LEFT JOIN (
      SELECT 
        target_id,
        COUNT(*) AS total_review,
        ROUND(AVG(rating), 1) AS avg_rating
      FROM reviews
      WHERE type = 'product'
      GROUP BY target_id
    ) r ON r.target_id = p.id

    -- orders count
    LEFT JOIN (
      SELECT 
        product_id,
        COUNT(*) AS total_order
      FROM order_items
      GROUP BY product_id
    ) o ON o.product_id = p.id

    LEFT JOIN seller_stores s ON s.seller_id = p.seller_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id

    WHERE p.admin_approval = 1;
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.getProductbySlug = (slug, userId, callback) => {
  const sql = `
    SELECT 
      p.*,
      pc.name AS category_name,
      s.store_name,

      CASE 
        WHEN fp.id IS NOT NULL THEN TRUE 
        ELSE FALSE 
      END AS is_favourite,

      COALESCE(r.total_review, 0) AS total_review,
      COALESCE(r.avg_rating, 0) AS average_rating,
      COALESCE(o.total_order, 0) AS total_order

    FROM products p

    LEFT JOIN favourites_product fp 
      ON p.id = fp.product_id 
      AND fp.user_id = ?

    LEFT JOIN (
      SELECT 
        target_id,
        COUNT(*) AS total_review,
        ROUND(AVG(rating), 1) AS avg_rating
      FROM reviews
      WHERE type = 'product'
      GROUP BY target_id
    ) r ON r.target_id = p.id

    LEFT JOIN (
      SELECT 
        product_id,
        COUNT(*) AS total_order
      FROM order_items
      GROUP BY product_id
    ) o ON o.product_id = p.id
    LEFT JOIN seller_stores s ON s.seller_id = p.seller_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id

    WHERE p.product_sku = ?;
  `;

  db.query(sql, [userId, slug], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0]);
  });
};


exports.getProductbyIDforVerify = (productId, callback) => {
  const sql = `
    SELECT * FROM products WHERE id = ?
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0]); // single product with is_favourite flag
  });
};


exports.getProductbyIDforVerification = (productId, callback) => {
  const sql = `
    SELECT 
      p.*
    FROM products p
    WHERE p.id = ?
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0]); // single product with is_favourite flag
  });
};


exports.deleteProductID = (id, callback) => {
  const sql = 'DELETE FROM products WHERE id = ?';
  db.query(sql, [id], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results); // returns info about the delete operation
  });
};

exports.updateProductByID = (id, data, callback) => {
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
    return callback(null, { affectedRows: 0 }); // No update fields provided
  }

  const sql = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  db.query(sql, values, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};