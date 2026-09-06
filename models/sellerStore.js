const db = require('../config/db');
const slugify = require('slugify');
const { formatImageSizes } = require('../utils/imageFormatter');

// ---------------- Callback-style Methods ---------------- //

// Get store by seller ID
exports.getStoreBySellerId = (sellerId, callback) => {
  const query = `
    SELECT 
      ss.id,
      ss.store_name,
      ss.store_username,
      ss.store_link,
      ss.slug,
      ss.description,
      COALESCE(ss.store_created_date, s.created_at, ss.created_at) AS store_created_date,
      ss.business_number,
      ss.store_image,
      s.first_name,
      s.last_name
    FROM seller_stores ss
    LEFT JOIN users s ON s.id = ss.seller_id
    WHERE ss.seller_id = ? 
    LIMIT 1
  `;

  db.query(query, [sellerId], (err, results) => {
    if (err) return callback(err, null);
    if (results.length === 0) return callback(null, null);

    let store = results[0];

    // Generate slug if it doesn't exist
    if (!store.slug) {
      const baseSlug = slugify(`${store.last_name}-${store.first_name}`, { lower: true });
      let slug = baseSlug;
      let counter = 1;

      const generateUniqueSlug = () => {
        db.query('SELECT id FROM seller_stores WHERE slug = ?', [slug], (err2, res2) => {
          if (err2) return callback(err2, null);

          if (res2.length > 0) {
            // Slug exists, add counter
            slug = `${baseSlug}-${counter}`;
            counter++;
            generateUniqueSlug();
          } else {
            // Slug is unique, update DB
            const storeLink = `https://backend.craftdelhi.com/backend/api/seller-store/${slug}`;
            db.query(
              'UPDATE seller_stores SET slug = ?, store_link = ? WHERE id = ?',
              [slug, storeLink, store.id],
              (err3) => {
                if (err3) return callback(err3, null);

                store.slug = slug;
                store.store_link = storeLink;

                return callback(null, store);
              }
            );
          }
        });
      };

      generateUniqueSlug();
    } else {
      // Slug already exists
      return callback(null, store);
    }
  });
};

// Create a store
exports.createStore = (data, callback) => {
  const query = `
    INSERT INTO seller_stores (seller_id, store_created_date, created_at)
    SELECT u.id, u.created_at, NOW()
    FROM users u WHERE u.id = ?
  `;
  db.query(query, [data.seller_id], (err, result) => {
    if (err) return callback(err);
    return callback(null, result);
  });
};

// Update store by seller ID
exports.updateStoreBySellerId = (sellerId, data, callback) => {
  const fields = [];
  const values = [];

  for (let key in data) {
    if (data[key] !== undefined && data[key] !== null) {
      if (key === 'store_created_date' && typeof data[key] === 'string' && data[key].trim() === '') {
        continue;
      }
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) return callback(null, { affectedRows: 0 });

  fields.push('updated_at = NOW()');
  const sql = `UPDATE seller_stores SET ${fields.join(', ')} WHERE seller_id = ?`;
  values.push(sellerId);

  db.query(sql, values, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

// Get store for auth
exports.getStoreBySellerIdforAuth = (sellerId, callback) => {
  const query = `SELECT * FROM seller_stores WHERE seller_id = ? LIMIT 1`;
  db.query(query, [sellerId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0] || null);
  });
};

// Find store by ID
exports.findById = (id, callback) => {
  db.query('SELECT * FROM seller_stores WHERE id = ? LIMIT 1', [id], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0] || null);
  });
};

// Check if slug exists
exports.isSlugExists = (slug, callback) => {
  db.query('SELECT id FROM seller_stores WHERE slug = ?', [slug], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results.length > 0);
  });
};

// Check if store_username exists for another seller
exports.checkUsernameExists = (username, currentSellerId, callback) => {
  if (!username) return callback(null, false);
  const query = 'SELECT id FROM seller_stores WHERE store_username = ? AND seller_id != ? LIMIT 1';
  db.query(query, [username, currentSellerId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results.length > 0);
  });
};

// Update slug and store_link
exports.updateSlug = (id, slug, storeLink, callback) => {
  db.query('UPDATE seller_stores SET slug = ?, store_link = ? WHERE id = ?', [slug, storeLink, id], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.getStoreBySlug = (slug, callback) => {
  const query = `
    SELECT 
      ss.id,
      ss.store_name,
      ss.store_username,
      ss.store_link,
      ss.slug,
      ss.description,
      COALESCE(ss.store_created_date, s.created_at, ss.created_at) AS store_created_date,
      ss.business_number,
      ss.store_image,
      s.first_name,
      s.last_name
    FROM seller_stores ss
    LEFT JOIN users s ON s.id = ss.seller_id
    WHERE ss.slug = ?
    LIMIT 1
  `;

  db.query(query, [slug], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0] || null);
  });
};

exports.getSaleSummary = (sellerId, callback) => {
  const sql = `
    SELECT 
      (SELECT COUNT(*) FROM order_details WHERE seller_id = ?) AS total_orders,
      (SELECT COUNT(*) FROM order_details WHERE seller_id = ? AND order_status != 4) AS total_sales,
      (SELECT COUNT(*) FROM order_details WHERE seller_id = ? AND order_status = 2) AS total_shipped_orders,
      (SELECT COUNT(*) FROM order_details WHERE seller_id = ? AND order_status = 3) AS total_delivered_orders,
      (SELECT COUNT(*) FROM order_details WHERE seller_id = ? AND order_status = 0) AS total_pending_orders,
      (SELECT COUNT(*) FROM order_details WHERE seller_id = ? AND order_status = 4) AS total_cancelled_orders
  `;

  db.query(sql, [sellerId, sellerId, sellerId, sellerId, sellerId, sellerId], (err, results) => {  // ✅ fix here
    if (err) return callback(err);
    callback(null, results[0]);
  });
};
exports.getAllProductsForSeller = (seller_id, callback) => {
  const sql = `
    SELECT
        p.*,

        CASE
            WHEN c.parent_id IS NULL THEN c.name
            ELSE parent.name
        END AS category_name,

        CASE
            WHEN c.parent_id IS NULL THEN NULL
            ELSE c.name
        END AS subcat_name

    FROM products p

    LEFT JOIN product_categories c
        ON c.id = p.category_id

    LEFT JOIN product_categories parent
        ON parent.id = c.parent_id

    WHERE p.seller_id = ?

    ORDER BY p.created_at DESC
  `;
  db.query(sql, [seller_id], callback);
};

exports.getAllProductsForSellerbyID = (seller_id, product_id, callback) => {
  const sql = `
    SELECT p.*
    FROM products p where p.seller_id = ? and p.id = ?
    ORDER BY p.created_at DESC
  `;
  db.query(sql, [seller_id, product_id], callback);
};

exports.getStoreDetails = (store_username, callback) => {
  const sql = `
    SELECT 
      COALESCE(parent_cat.name, pc.name) AS category_name,
      COALESCE(parent_cat.category_image, pc.category_image) AS category_image,
      COALESCE(parent_cat.id, pc.id) AS w,

      p.*,

      COALESCE(ss.store_created_date, u.created_at, ss.created_at) AS store_created_date,
      ss.description AS store_description,
      ss.store_name,
      ss.store_image,

      COALESCE(r.total_review, 0) AS total_review,
      COALESCE(r.avg_rating, 0) AS average_rating,

      COALESCE(o.total_order, 0) AS total_order,

      COALESCE(sr.positive_rating_percentage, 0) AS seller_positive_rating_percentage

    FROM products p

    -- Seller user details
    LEFT JOIN users u
      ON u.id = p.seller_id

    -- Product category (can be sub or main)
    LEFT JOIN product_categories pc 
      ON pc.id = p.category_id

    -- Parent category (if exists)
    LEFT JOIN product_categories parent_cat
      ON parent_cat.id = pc.parent_id

    -- Reviews
    LEFT JOIN (
      SELECT 
        target_id,
        COUNT(*) AS total_review,
        ROUND(AVG(rating), 1) AS avg_rating
      FROM reviews
      WHERE type = 'product'
      GROUP BY target_id
    ) r ON r.target_id = p.id

    -- Orders
    LEFT JOIN (
      SELECT 
        product_id,
        COUNT(*) AS total_order
      FROM order_items
      GROUP BY product_id
    ) o ON o.product_id = p.id

    -- Seller store
    LEFT JOIN seller_stores ss 
      ON ss.seller_id = p.seller_id

    -- Seller rating %
    LEFT JOIN (
      SELECT 
        target_id AS seller_id,
        ROUND(
          (SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) * 100.0) 
          / COUNT(*),
        2) AS positive_rating_percentage
      FROM reviews
      WHERE type = 'seller'
      GROUP BY target_id
    ) sr ON sr.seller_id = p.seller_id

    WHERE ss.store_username = ?;
  `;

  db.query(sql, [store_username], (err, results) => {
    if (err) return callback(err);

    const categoriesMap = new Map();
    const productsMap = new Map();
    const videos = new Set();
    const reels = new Set();
    const storesMap = new Map(); // ✅ store data

    results.forEach(row => {

      // Categories
      if (row.category_name) {
        if (!categoriesMap.has(row.w)) {
          categoriesMap.set(row.w, {
            id: row.w,
            name: row.category_name,
            image: row.category_image
          });
        }
      }

      // Store Data
      if (!storesMap.has(row.seller_id)) {
        storesMap.set(row.seller_id, {
          store_id: row.seller_id,
          store_name: row.store_name,
          store_image: formatImageSizes(row.store_image),
          store_description: row.store_description,
          store_created_date: row.store_created_date,
          positive_rating_percentage: row.seller_positive_rating_percentage
        });
      }

      // Products (unique by SKU)
      if (!productsMap.has(row.product_sku)) {
        productsMap.set(row.product_sku, {
          id: row.id,
          name: row.name,
          seller_id: row.seller_id,
          storeId: row.seller_id,
          product_sku: row.product_sku,
          description: row.description,
          price: row.price,
          stock: row.stock,
          dimension: row.dimension,
          package_weight: row.package_weight,
          weight_type: row.weight_type,
          warranty_type: row.warranty_type,
          main_image_url: row.main_image_url,
          gallery_images: row.gallery_images,
          category_id: row.category_id,

          total_review: row.total_review,
          average_rating: row.average_rating,
          total_order: row.total_order,

          created_at: row.created_at
        });
      }

      // Media
      if (row.video_url) videos.add(row.video_url);
      if (row.reel_url) reels.add(row.reel_url);
    });

    callback(null, {
      categories: [...categoriesMap.values()],
      products: [...productsMap.values()],
      store_data: [...storesMap.values()], // ✅ separate store array
      media: {
        videos: [...videos],
        reels: [...reels]
      }
    });
  });
};


