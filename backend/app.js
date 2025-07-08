require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const cron = require('node-cron');
const { processPreviousDayShipments, getCoverzySettings } = require('./cron/coverzyCron');
const pool = require('./config/db');

const app = express();
const port = process.env.PORT;

// Global error handlers to prevent process crashes
process.on('uncaughtException', (error) => {
  console.error(' Uncaught Exception:', error.message);
  console.error('Stack:', error.stack);
  console.log(' Server continuing to run...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(' Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  console.log(' Server continuing to run...');
});



// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Routes
app.use('/api/v1', require('./routes/test'));

// Authentication routes (separate JWT-based auth for frontend login)
app.use('/api/auth', require('./auth/authRoutes'));

// Global error handling middleware (must be after routes)
app.use((err, req, res, next) => {
  console.error(' Express Error Handler:', err.message);
  console.error('Stack:', err.stack);
  
  res.status(err.status || 500).json({
    success: false,
    message: 'Internal server error',
    error_details: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});


// Test database connection on startup
const testDatabaseConnection = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute('SELECT 1');
    console.log('Connected to DB');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    console.error('Server will continue running, but database operations will fail');
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Configure cron job based on cip_time from database
const setupDynamicCronJob = async () => {
  try {
    // Get current settings from database
    const settings = await getCoverzySettings();
    const cipTime = settings.cipTime; // Format: "HH:MM:SS" from database
    
    if (!cipTime || !cipTime.match(/^\d{2}:\d{2}:\d{2}$/)) {
      console.error('Invalid or missing cip_time in database. Expected format: HH:MM:SS');
      return;
    }
    
    // Extract hours and minutes from cip_time (ignore seconds)
    const [hours, minutes] = cipTime.split(':');
    const timeForCron = `${hours}:${minutes}`;
    
    // Create cron expression: "minutes hours * * *" (daily)
    const cronExpression = `${minutes} ${hours} * * *`;
    
    console.log(`Setting up cron job based on database cip_time: ${cipTime}`);
    console.log(`Cron expression: ${cronExpression} (${hours}:${minutes} daily)`);
    
    // Schedule the cron job
    cron.schedule(cronExpression, async () => {
      console.log('======================================');
      console.log(`Running Coverzy cron job at ${new Date().toLocaleString()} (cip_time: ${timeForCron})`);
      console.log('======================================');
      
      try {
        const result = await processPreviousDayShipments();
        console.log(`Cron completed: Processed ${result.processed} shipments, with ${result.results.length} successful and ${result.errors.length} failed`);
      } catch (error) {
        console.error('Cron job failed:', error.message);
      }
      
      console.log('======================================');
    }, {
      timezone: "Asia/Kolkata" // Indian timezone
    });
    
    console.log(`Coverzy cron job scheduled successfully for ${timeForCron} daily (IST)`);
    
  } catch (error) {
    console.error('Failed to setup dynamic cron job:', error.message);
    console.error('Make sure coverzy_settings table has valid data with cip_time field');
  }
};

// Start server with HTTP/HTTPS based on environment
const startServer = async () => {
  console.log('Testing database connection...');
  await testDatabaseConnection();
  
  // Setup dynamic cron job based on database cip_time
  await setupDynamicCronJob();
  
  if (process.env.NODE_ENV === "local") {
    const server = http.createServer(app);
    server.listen(port, () => {
      console.log(`Server running on port ${port}...`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log('Application startup complete!');
    });
  } else {
    try {
      let keyPath = process.env.KEY_DEV;
      let certPath = process.env.CERT_DEV;
      
      if (!keyPath || !certPath) {
        throw new Error('SSL certificate paths not configured. Set KEY_DEV and CERT_DEV environment variables.');
      }
      
      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      
      const server = https.createServer(options, app);
      server.listen(port, () => {
        console.log(`Server running on port ${port}...`);
        console.log(`Environment: ${process.env.NODE_ENV}`);
        console.log('Application startup complete!');
      });
    } catch (error) {
      console.error('Failed to start HTTPS server:', error.message);
      console.log('Falling back to HTTP server...');
      
      const server = http.createServer(app);
      server.listen(port, () => {
        console.log(`HTTP Server running on port ${port} (fallback)...`);
        console.log(`Environment: ${process.env.NODE_ENV}`);
        console.log('Application startup complete!');
      });
    }
  }
};

startServer();

module.exports = app;
