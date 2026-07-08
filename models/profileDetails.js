const db = require('../config/db');

exports.getProfileDetails = (userId, callback) => {
  const query = `
    SELECT 
    pd.phone_number,
    pd.email,
    pd.first_name,
    pd.last_name,
    pd.date_of_birth,
    pd.gender,
    od.city,
    od.home_address,
    od.profile_image,
    od.office_address
    FROM users pd
    LEFT JOIN seller_details od ON od.user_id = pd.id
    WHERE pd.id = ?
    LIMIT 1;
  `;

  db.query(query, [userId], (err, results) => {
    if (err) return callback(err, null);
    if (results.length === 0) return callback(null, null); // No store found

    return callback(null, results[0]); // Return the store row
  });
};

exports.getUserProfileDetails = (userId, callback) => {
  const sql = `
    SELECT 
      u.id,
      u.phone_number,
      u.email,
      u.first_name,
      u.last_name,
      u.date_of_birth,
      u.gender,
      up.profile_image,

      ua.id AS address_id,
      ua.street,
      ua.city,
      ua.state,
      ua.country,
      ua.postal_code

    FROM users u
    LEFT JOIN user_profile up ON up.user_id = u.id
    LEFT JOIN user_addresses ua ON ua.user_id = u.id
    WHERE u.id = ?
  `;

  db.query(sql, [userId], (err, rows) => {
    if (err) return callback(err, null);
    if (!rows.length) return callback(null, null);
    const user = {
      id: rows[0].id,
      phone_number: rows[0].phone_number,
      email: rows[0].email,
      first_name: rows[0].first_name,
      last_name: rows[0].last_name,
      date_of_birth: rows[0].date_of_birth,
      gender: rows[0].gender,
      profile_image: rows[0].profile_image,
      addresses: []
    };
    rows.forEach(row => {
      if (row.address_id) {
        user.addresses.push({
          id: row.address_id,
          street: row.street,
          city: row.city,
          state: row.state,
          country: row.country,
          postal_code: row.postal_code
        });
      }
    });

    return callback(null, user);
  });
};


exports.getProfileOtherDetails = (userId, callback) => {
  const query = `
    SELECT 
    od.city,
    od.home_address,
    od.profile_image,
    od.office_address
    FROM seller_details od
    WHERE od.user_id = ?
    LIMIT 1;
  `;

  db.query(query, [userId], (err, results) => {
    if (err) return callback(err, null);
    if (results.length === 0) return callback(null, null); // No store found

    return callback(null, results[0]); // Return the store row
  });
};


exports.createDetails = (user_id, callback) => {
  const query = `
    INSERT INTO seller_details (user_id, created_at)
    VALUES (?, NOW())
  `;
  db.query(query, [user_id], (err, result) => {
    if (err) return callback(err);
    return callback(null, result);
  });
};

exports.updateProfileDetails = (userId, data, callback) => {
  const userFields = [];
  const userValues = [];
  const detailFields = [];
  const detailValues = [];

  // Split fields between users and seller_details
  for (let key in data) {
    if (data[key] !== undefined) {
      if (["phone_number", "date_of_birth", "gender"].includes(key)) { // ✅ Added gender here
        userFields.push(`${key} = ?`);
        userValues.push(data[key]);
      } else if (["city", "home_address", "profile_image", "office_address"].includes(key)) {
        detailFields.push(`${key} = ?`);
        detailValues.push(data[key]);
      }
    }
  }

  const updateUser = () => {
    if (userFields.length === 0) {
      return Promise.resolve();
    }

    const userSql = `UPDATE users SET ${userFields.join(', ')} WHERE id = ?`;
    userValues.push(userId);

    return new Promise((resolve, reject) => {
      db.query(userSql, userValues, (err, result) => {
        if (err) {
          console.error("User Update Error:", err);
          return reject(err);
        }
        resolve(result);
      });
    });
  };

  const updateDetails = () => {
    if (detailFields.length === 0) {
      return Promise.resolve();
    }

    const updateDetailFields = [...detailFields, `updated_at = NOW()`];
    const detailSql = `UPDATE seller_details SET ${updateDetailFields.join(', ')} WHERE user_id = ?`;
    detailValues.push(userId);

    return new Promise((resolve, reject) => {
      db.query(detailSql, detailValues, (err, result) => {
        if (err) {
          console.error("Details Update Error:", err);
          return reject(err);
        }
        resolve(result);
      });
    });
  };

  // Run both updates
  Promise.all([updateUser(), updateDetails()])
    .then(([userRes, detailRes]) => {
      callback(null, {
        userUpdate: userRes || { affectedRows: 0 },
        detailUpdate: detailRes || { affectedRows: 0 }
      });
    })
    .catch(err => {
      console.error("Update Error (Promise.all):", err);
      callback(err, null);
    });
};


exports.getProfileIdforAuth = (userId, callback) => {
  const query = `SELECT * FROM users WHERE id = ? LIMIT 1`;
  db.query(query, [userId], (err, results) => {
    if (err) return callback(err, null);
    return callback(null, results[0] || null);
  });
};

exports.createBankDetails = (userId, callback) => {
  const sql = `INSERT INTO users_bank_details (user_id) VALUES (?)`;
  db.query(sql, [userId], (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
};

// 3. Update bank details
exports.updateBankDetails = (userId, updateData, callback) => {
  const fields = [];
  const values = [];

  for (let key in updateData) {
    if (updateData[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updateData[key]);
    }
  }

  if (fields.length === 0) return callback(null, { affectedRows: 0 });

  fields.push('updated_at = CURRENT_TIMESTAMP');
  const sql = `UPDATE users_bank_details SET ${fields.join(', ')} WHERE user_id = ?`;
  values.push(userId);

  db.query(sql, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
};

// 4. (Optional) For authorization logic
exports.getBankDetailsForAuth = (userId, callback) => {
  const sql = `SELECT user_id FROM users_bank_details WHERE user_id = ? LIMIT 1`;
  db.query(sql, [userId], (err, results) => {
    if (err) return callback(err);
    callback(null, results[0] || null);
  });
};



exports.getBankDetails = (userId, callback) => {
  const query = `
    SELECT 
      UBD.bank_name,
      UBD.branch_location,
      UBD.account_holder_name,
      UBD.account_number,    
      UBD.ifsc_code,
      UBD.razorpay_contact_id,
      UBD.razorpay_fund_account_id
    FROM users_bank_details UBD
    WHERE UBD.user_id = ?
    LIMIT 1;
  `;


  db.query(query, [userId], (err, results) => {
    if (err) return callback(err, null);
    if (results.length === 0) return callback(null, null); // No store found

    return callback(null, results[0]); // Return the store row
  });
};

exports.updateUserProfileDetails = (userId, data, callback) => {
  const userFields = [];
  const userValues = [];
  const detailFields = [];
  const detailValues = [];
  const addressFields = [];
  const addressValues = [];

  for (let key in data) {
    if (data[key] !== undefined) {
      if (["phone_number", "date_of_birth", "gender", "first_name", "last_name", "email"].includes(key)) {
        userFields.push(`${key} = ?`);
        userValues.push(data[key]);
      } 
      else if (key === "profile_image") {
        detailFields.push(`${key} = ?`);
        detailValues.push(data[key]);
      } 
      else if (["city", "street", "postal_code", "country", "state"].includes(key)) {
        addressFields.push(`${key} = ?`);
        addressValues.push(data[key]);
      }
    }
  }

  /* ---------- USERS ---------- */
  const updateUser = () => {
    if (!userFields.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      db.query(
        `UPDATE users SET ${userFields.join(", ")} WHERE id = ?`,
        [...userValues, userId],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
  };

  /* ---------- PROFILE ---------- */
  const updateProfile = () => {
    if (!detailFields.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      db.query(
        `
        INSERT INTO user_profile (user_id, profile_image)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          profile_image = VALUES(profile_image),
          updated_at = NOW()
        `,
        [userId, detailValues[0]],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
  };

  /* ---------- ADDRESS (UPDATE OR INSERT) ---------- */
  const saveAddress = () => {
    if (!addressFields.length) return Promise.resolve();

    // ✅ UPDATE EXISTING ADDRESS
    if (data.address_id) {
      return new Promise((resolve, reject) => {
        db.query(
          `
          UPDATE user_addresses
          SET ${addressFields.join(", ")}, updated_at = NOW()
          WHERE id = ? AND user_id = ?
          `,
          [...addressValues, Number(data.address_id), userId],
          (err, res) => (err ? reject(err) : resolve(res))
        );
      });
    }

    // ✅ CREATE NEW ADDRESS
    const columns = addressFields.map(f => f.split(" = ")[0]);

    return new Promise((resolve, reject) => {
      db.query(
        `
        INSERT INTO user_addresses (user_id, ${columns.join(", ")})
        VALUES (?, ${columns.map(() => "?").join(", ")})
        `,
        [userId, ...addressValues],
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
  };

  Promise.all([updateUser(), updateProfile(), saveAddress()])
    .then(([userRes, profileRes, addressRes]) => {
      callback(null, {
        userUpdate: userRes || { affectedRows: 0 },
        profileUpdate: profileRes || { affectedRows: 0 },
        addressUpdate: addressRes || { affectedRows: 0 }
      });
    })
    .catch(err => callback(err));
};

