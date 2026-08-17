const db = require('../config/db');

// Check if a category exists by name + creator
exports.findCategoryByNameAndCreator = (name, createdBy, creatorId, callback) => {
  const query = `
    SELECT * FROM product_categories 
    WHERE name = ? AND created_by = ? AND ${creatorId ? 'creator_id = ?' : 'creator_id IS NULL'}
  `;

  const values = creatorId ? [name, createdBy, creatorId] : [name, createdBy];

  db.query(query, values, (err, results) => {
    if (err) return callback(err, null);
    callback(null, results);
  });
};

// Insert a new category
exports.createCategory = (name, slug, createdBy, creatorId, category_image, category_description, callback) => {
  const sql = `
    INSERT INTO product_categories 
    (name, slug, created_by, creator_id, category_image, category_description) 
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [name, slug, createdBy, creatorId, category_image, category_description], callback);
};

exports.getallCategories = (callback) => {
  const sql = 'SELECT * FROM product_categories where parent_id is null'; // Adjust table name if needed
  db.query(sql, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.getCategorybyID = (id, callback) => {
  const sql = 'SELECT * FROM product_categories WHERE id = ? and parent_id is null';
  db.query(sql, [id], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0]); // assuming you want a single product
  });
};

exports.getCategorybySlug = (slug, callback) => {
  const sql = 'SELECT * FROM product_categories WHERE slug = ? and parent_id is null';
  db.query(sql, [slug], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0]);
  });
};

exports.deleteCategoryID = (id, callback) => {
  const sql = 'DELETE FROM product_categories WHERE id = ?';
  db.query(sql, [id], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results); // returns info about the delete operation
  });
};

exports.updateCategoryByID = (id, data, callback) => {
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

  const sql = `UPDATE product_categories SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  db.query(sql, values, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.createSubCategory = (name, slug, parentId, createdBy, creatorId, callback) => {
  const query = `
    INSERT INTO product_categories (name, slug, parent_id, created_by, creator_id)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(query, [name, slug, parentId, createdBy, creatorId], (err, result) => {
    if (err) return callback(err, null);
    callback(null, result);
  });
};

exports.getSubCategoriesByCategory = (parentId, callback) => {
  const sql = `SELECT * FROM product_categories WHERE parent_id = ?`;

  db.query(sql, [parentId], (err, results) => {
    if (err) return callback(err, null);
    callback(null, results);
  });
};

exports.deleteSubCategoryByID = (id, callback) => {
  const sql = `
    DELETE FROM product_categories
    WHERE id = ? AND parent_id IS NOT NULL
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.updateSubCategoryByID = (id, data, callback) => {
  const fields = [];
  const values = [];

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
    UPDATE product_categories 
    SET ${fields.join(', ')} 
    WHERE id = ? AND parent_id IS NOT NULL
  `;

  values.push(id);

  db.query(sql, values, (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results);
  });
};

exports.getProductByCategory = (categoryIdentifier, callback) => {
  const fetchProductsByCatId = (catId) => {
    const sql = `
      SELECT 
        p.*,
        p.seller_id as storeId,
        pc.name AS category_name,
        pc.slug AS category_slug,
        s.store_name,
        s.store_username,

        COALESCE(r.total_review, 0) AS total_review,
        COALESCE(r.avg_rating, 0) AS average_rating,
        COALESCE(o.total_order, 0) AS total_order

      FROM products p

      LEFT JOIN (
        SELECT target_id, COUNT(*) AS total_review, ROUND(AVG(rating), 1) AS avg_rating
        FROM reviews
        WHERE type = 'product'
        GROUP BY target_id
      ) r ON r.target_id = p.id

      LEFT JOIN (
        SELECT product_id, COUNT(*) AS total_order
        FROM order_items
        GROUP BY product_id
      ) o ON o.product_id = p.id

      LEFT JOIN seller_stores s ON s.seller_id = p.seller_id
      LEFT JOIN product_categories pc ON pc.id = p.category_id

      LEFT JOIN product_categories sub 
        ON sub.id = p.category_id AND sub.parent_id = ?

      WHERE 
        p.category_id = ? 
        OR sub.id IS NOT NULL;
    `;

    db.query(sql, [catId, catId], callback);
  };

  const isNumeric = !isNaN(categoryIdentifier) && Number.isInteger(Number(categoryIdentifier));
  if (isNumeric) {
    fetchProductsByCatId(categoryIdentifier);
  } else {
    // Look up category ID by slug
    const findSql = `SELECT id FROM product_categories WHERE slug = ? LIMIT 1`;
    db.query(findSql, [categoryIdentifier], (err, results) => {
      if (err) return callback(err, null);
      if (results && results.length > 0) {
        fetchProductsByCatId(results[0].id);
      } else {
        fetchProductsByCatId(categoryIdentifier);
      }
    });
  }
};