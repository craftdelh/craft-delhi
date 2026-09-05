const db = require('../config/db'); // MySQL connection

exports.searchProductsByNameAndCategory = (search, callback) => {
  const sql = `
    SELECT 
      p.*,
      c.name AS category_name
    FROM products p
    LEFT JOIN product_categories c
      ON c.id = p.category_id
    WHERE 
      p.status = 1
      AND p.admin_approval = 1
      AND (
        p.name LIKE ?
        OR c.name LIKE ?
      )
    ORDER BY p.created_at DESC
  `;

  const searchValue = `%${search}%`;

  db.query(sql, [searchValue, searchValue], callback);
};