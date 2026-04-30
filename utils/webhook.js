const { exec } = require('child_process');

const webhookHandler = async (req, res) => {
    console.log('✅ GitHub webhook triggered!');

    // Step 1: Git pull
    exec('git pull origin main', (err, stdout, stderr) => {
        if (err) {
            console.error('❌ Git pull failed:', err);
            return res.status(500).send('Git pull failed');
        }

        console.log('📥 Git Pull Output:', stdout);

        // Step 2: Clean install (production-safee)
        exec('npm ci', (err1, stdout1, stderr1) => {
            if (err1) {
                console.error('❌ npm ci failed:', err1);
                return res.status(500).send('npm ci failed');
            }

            console.log('📦 NPM CI Output:', stdout1);

            // Step 3: PM2 restart
            exec('pm2 restart backend-server', (err2, stdout2, stderr2) => {
                if (err2) {
                    console.error('❌ PM2 restart failed:', err2);
                    return res.status(500).send('PM2 restart failed');
                }

                console.log('🚀 PM2 Restart Output:', stdout2);

                res.status(200).send('✅ Git pulled, npm ci done, server restarted');
            });
        });
    });
};

module.exports = webhookHandler;