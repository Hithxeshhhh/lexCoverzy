require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const cron = require('node-cron');
const { processPreviousDayShipments } = require('./cron/coverzyCron');
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

// Configure daily cron job for Coverzy API processing
const setupCronJobs = () => {
  // Schedule the cron job to run at 11:00 AM every day (server time)
  cron.schedule('0 11 * * *', async () => {
    console.log('======================================');
    console.log(` Running scheduled Coverzy cron job at ${new Date().toLocaleString()}`);
    console.log('======================================');
    
    try {
      const result = await processPreviousDayShipments();
      console.log(` Scheduled cron completed: Processed ${result.processed} shipments, with ${result.results.length} successful and ${result.errors.length} failed`);
    } catch (error) {
      console.error(' Scheduled cron failed:', error.message);
    }
    
    console.log('======================================');
  }, {
    timezone: "Asia/Kolkata" // Set to Indian timezone
  });
  
  console.log('Coverzy cron job scheduled for 11:00 AM daily');
};

// Start server with HTTP/HTTPS based on environment
const startServer = async () => {
  console.log('Testing database connection...');
  await testDatabaseConnection();
  
  // Setup cron jobs
  setupCronJobs();
  
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
