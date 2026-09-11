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
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to MySQL database:', process.env.DB_NAME);

  const alterQueries = [
    `ALTER TABLE seller_details MODIFY COLUMN profile_image TEXT;`,
    `ALTER TABLE user_profile MODIFY COLUMN profile_image TEXT;`,
    `ALTER TABLE seller_stores MODIFY COLUMN store_image TEXT;`
  ];

  let completed = 0;
  alterQueries.forEach((query) => {
    connection.query(query, (err, results) => {
      if (err) {
        console.error(`❌ Migration failed for query: "${query}"`, err.message);
      } else {
        console.log(`✅ Migration executed successfully: "${query}"`);
      }
      completed++;
      if (completed === alterQueries.length) {
        connection.end();
      }
    });
  });
});
