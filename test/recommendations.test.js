const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');

test('recommendations use server-side ranking and a bounded result limit', async () => {
  const originalQuery = db.query;

  try {
    let capturedSql;
    let capturedValues;
    db.query = (sql, values, callback) => {
      capturedSql = sql;
      capturedValues = values;
      callback(null, [{ id: 2, recommendation_score: 150 }]);
    };

    delete require.cache[require.resolve('../models/productModel')];
    const productModel = require('../models/productModel');

    const results = await new Promise((resolve, reject) => {
      productModel.getRecommendationsBySlug('SKU-current', 500, (err, products) => {
        if (err) reject(err);
        else resolve(products);
      });
    });

    assert.deepEqual(results, [{ id: 2, recommendation_score: 150 }]);
    assert.deepEqual(capturedValues, ['SKU-current', 12]);
    assert.match(capturedSql, /candidate\.id <> current_product\.id/);
    assert.match(capturedSql, /candidate\.admin_approval = 1/);
    assert.match(capturedSql, /candidate\.status = 1/);
    assert.match(capturedSql, /recommendation_score DESC/);
  } finally {
    db.query = originalQuery;
  }
});
