const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');

test('notificationHelper creates DB record and emits Socket.IO event', async () => {
  const originalQuery = db.query;

  try {
    let capturedSql = '';
    let capturedData = null;

    db.query = (sql, data, callback) => {
      capturedSql = sql;
      capturedData = data;
      if (typeof callback === 'function') {
        callback(null, { insertId: 99 });
      } else if (typeof data === 'function') {
        data(null, { insertId: 99 });
      }
    };

    // Mock global.io
    const emittedEvents = [];
    global.io = {
      to: (room) => ({
        emit: (event, payload) => {
          emittedEvents.push({ room, event, payload });
        }
      }),
      emit: (event, payload) => {
        emittedEvents.push({ room: 'broadcast', event, payload });
      }
    };

    const { sendNotification } = require('../utils/notificationHelper');

    const result = await sendNotification({
      userId: 42,
      title: 'Order Placed',
      message: 'Your order #ORD123 was placed',
      type: 'ORDER_PLACED',
      referenceId: 'ORD123'
    });

    assert.equal(result.id, 99);
    assert.equal(result.user_id, 42);
    assert.equal(result.title, 'Order Placed');
    assert.equal(result.type, 'ORDER_PLACED');

    // Verify socket emissions
    assert.equal(emittedEvents.length, 2);
    assert.equal(emittedEvents[0].room, 'user_42');
    assert.equal(emittedEvents[0].event, 'notification');
    assert.equal(emittedEvents[0].payload.title, 'Order Placed');
  } finally {
    db.query = originalQuery;
    delete global.io;
  }
});
