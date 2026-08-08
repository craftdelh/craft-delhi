require('dotenv').config();
const db = require('../config/db');
const settlementService = require('../utils/settlementService');

const retryFailedSettlements = async () => {
  if (process.env.ENABLE_SETTLEMENT_PROCESS !== 'true') {
    console.log('[Settlement Service] [ON HOLD] Settlement process is currently ON HOLD. Exiting retry script.');
    process.exit(0);
  }

  console.log('--- STARTING RETRY OF FAILED/PENDING SETTLEMENTS ---');
  
  // Find all failed or pending settlements
  db.query(
    "SELECT * FROM settlements WHERE payout_status = 'failed' OR payout_status = 'pending'", 
    async (err, results) => {
      if (err) {
        console.error('Error fetching failed settlements:', err);
        process.exit(1);
      }
      
      if (results.length === 0) {
        console.log('No failed or pending settlements found.');
        db.end();
        return;
      }
      
      console.log(`Found ${results.length} failed/pending settlements to process.`);
      
      for (let settlement of results) {
        console.log(`\nRetrying Settlement ID: ${settlement.id} (Order #${settlement.order_id}, Seller #${settlement.seller_id}, Total Amount: INR ${settlement.total_amount})`);
        
        try {
          // 1. Delete the old failed record to prevent duplicate logs in database
          await new Promise((resolve, reject) => {
            db.query('DELETE FROM settlements WHERE id = ?', [settlement.id], (delErr) => {
              if (delErr) {
                console.error(`Failed to delete old record ID ${settlement.id}:`, delErr);
                reject(delErr);
              } else {
                resolve();
              }
            });
          });
          
          // 2. Re-trigger the settlement flow (it will recalculate and create a new database entry)
          await settlementService.processSettlement(settlement.order_id, settlement.seller_id, parseFloat(settlement.total_amount));
          console.log(`Successfully re-processed settlement for Order #${settlement.order_id}`);
        } catch (procErr) {
          console.error(`Failed to re-process settlement ID ${settlement.id}:`, procErr.message || procErr);
        }
      }
      
      console.log('\n--- RETRY TASK COMPLETED ---');
      db.end();
    }
  );
};

retryFailedSettlements();
