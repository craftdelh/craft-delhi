const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'craft_delhi',
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to MySQL database:', process.env.DB_NAME);

  const columnRenames = [
    { table: 'payments', oldCol: 'payu_txn_id', newCol: 'razorpay_order_id' },
    { table: 'users_bank_details', oldCol: 'payu_beneficiary_id', newCol: 'razorpay_contact_id' },
    { table: 'users_bank_details', oldCol: 'payu_fund_account_id', newCol: 'razorpay_fund_account_id' },
    { table: 'settlements', oldCol: 'payu_payout_id', newCol: 'razorpay_payout_id' },
    { table: 'settlements', oldCol: 'payu_beneficiary_id', newCol: 'razorpay_contact_id' },
    { table: 'settlements', oldCol: 'payu_fund_account_id', newCol: 'razorpay_fund_account_id' }
  ];

  let pending = columnRenames.length;

  const checkAndRename = (item) => {
    const checkQuery = `
      SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `;

    connection.query(checkQuery, [process.env.DB_NAME, item.table, item.oldCol], (err, results) => {
      if (err) {
        console.error(`❌ Error checking column ${item.oldCol} in ${item.table}:`, err.message);
        finish();
        return;
      }

      if (results.length > 0) {
        // Old column exists, rename it
        const columnType = results[0].COLUMN_TYPE;
        const isNullable = results[0].IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
        
        console.log(`🔄 Column ${item.oldCol} in ${item.table} exists. Renaming to ${item.newCol}...`);
        
        const alterQuery = `
          ALTER TABLE ${item.table} 
          CHANGE COLUMN ${item.oldCol} ${item.newCol} ${columnType} ${isNullable}
        `;

        connection.query(alterQuery, (alterErr) => {
          if (alterErr) {
            console.error(`❌ Failed to rename ${item.oldCol} to ${item.newCol} in ${item.table}:`, alterErr.message);
          } else {
            console.log(`✅ Successfully renamed ${item.oldCol} to ${item.newCol} in table ${item.table}`);
          }
          finish();
        });
      } else {
        // Old column does not exist. Check if new column is already present.
        connection.query(checkQuery, [process.env.DB_NAME, item.table, item.newCol], (err2, results2) => {
          if (results2 && results2.length > 0) {
            console.log(`ℹ️ Column ${item.newCol} is already present in ${item.table}. Skipping.`);
          } else {
            console.warn(`⚠️ Neither ${item.oldCol} nor ${item.newCol} exists in ${item.table}.`);
          }
          finish();
        });
      }
    });
  };

  const finish = () => {
    pending--;
    if (pending === 0) {
      console.log('🎉 Razorpay migration completed.');
      connection.end();
    }
  };

  columnRenames.forEach(checkAndRename);
});
