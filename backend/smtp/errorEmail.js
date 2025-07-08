const nodemailer = require('nodemailer');
const pool = require('../config/db');
require('dotenv').config();

// === Email Configuration ===
const createEmailTransporter = () => {
    // Debug environment variables
    // console.log('Environment Check:');
    // console.log('   Mail Host:', process.env.MAIL_HOST ? 'SET' : 'NOT SET');
    // console.log('   Mail Username:', process.env.MAIL_USERNAME ? 'SET' : 'NOT SET');
    // console.log('   Mail Password:', process.env.MAIL_PASSWORD ? `SET (${process.env.MAIL_PASSWORD.length} chars)` : 'NOT SET');
    // console.log('   Mail From Address:', process.env.MAIL_FROM_ADDRESS ? 'SET' : 'NOT SET');
    
    const smtpConfig = {
        host: process.env.MAIL_HOST,
        port: parseInt(process.env.MAIL_PORT) || 587,
        secure: process.env.MAIL_ENCRYPTION === 'ssl', // true for SSL (port 465), false for TLS
        auth: {
            user: process.env.MAIL_USERNAME,
            pass: process.env.MAIL_PASSWORD
        },
        tls: {
            ciphers: 'SSLv3'
        }
    };

    if (!process.env.MAIL_HOST || !process.env.MAIL_USERNAME || !process.env.MAIL_PASSWORD) {
        console.log('Warning: Zepto Mail SMTP credentials not found in environment variables');
    }

    return nodemailer.createTransport(smtpConfig);
};

// Get admin email and email settings from coverzy_settings table
const getEmailSettings = async () => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT admin_emails, email_enabled 
            FROM coverzy_settings 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        
        if (rows.length > 0) {
            return {
                adminEmails: rows[0].admin_emails.split(',').map(email => email.trim()),
                emailEnabled: rows[0].email_enabled || false
            };
        } else {
            console.log('Error: No settings found in coverzy_settings');
            return null;
        }
    } catch (error) {
        console.error('Error fetching email settings from database:', error.message);
        return null;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Get admin email from coverzy_settings table (backward compatibility)
const getAdminEmail = async () => {
    const settings = await getEmailSettings();
    return settings?.adminEmails?.[0] || null;
};

// Send cron job error notification email
const sendCronErrorEmail = async (errorData) => {
    try {
        // Check if email service is enabled
        const emailSettings = await getEmailSettings();
        
        if (!emailSettings) {
            console.log('❌ Email settings not found in database');
            return {
                success: false,
                error: 'Email settings not found in database'
            };
        }
        
        if (!emailSettings.emailEnabled) {
            console.log('📧 Email service is disabled - skipping error notification');
            return {
                success: false,
                error: 'Email service is disabled',
                skipped: true
            };
        }
        
        const transporter = createEmailTransporter();
        
        const { 
            jobName, 
            errorType, 
            errorMessage, 
            executionDate, 
            totalShipments = 0, 
            processedShipments = 0, 
            failedShipments = 0, 
            errorDetails = null,
            specificErrors = []
        } = errorData;

        const subject = `🚨 Cron Job Failure Alert - ${jobName} (${executionDate})`;
        
        // Create detailed HTML email body
        const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .header { background-color: #dc3545; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .summary { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0; }
                .stats { display: flex; justify-content: space-around; margin: 20px 0; }
                .stat-box { text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 5px; }
                .error-list { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 10px 0; }
                .footer { background-color: #6c757d; color: white; padding: 15px; text-align: center; margin-top: 30px; }
                .timestamp { color: #6c757d; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🚨 Cron Job Error Alert</h1>
                <p>Coverzy Daily Shipments Processing Failed</p>
            </div>
            
            <div class="content">
                <div class="summary">
                    <h3>Error Summary</h3>
                    <p><strong>Job Name:</strong> ${jobName}</p>
                    <p><strong>Execution Date:</strong> ${executionDate}</p>
                    <p><strong>Error Type:</strong> ${errorType}</p>
                    <p><strong>Error Message:</strong> ${errorMessage}</p>
                    <p class="timestamp"><strong>Alert Time:</strong> ${new Date().toLocaleString()}</p>
                </div>

                <div class="stats">
                    <div class="stat-box">
                        <h4>📊 Total Shipments</h4>
                        <h2 style="color: #007bff;">${totalShipments}</h2>
                    </div>
                    <div class="stat-box">
                        <h4>✅ Processed</h4>
                        <h2 style="color: #28a745;">${processedShipments}</h2>
                    </div>
                    <div class="stat-box">
                        <h4>❌ Failed</h4>
                        <h2 style="color: #dc3545;">${failedShipments}</h2>
                    </div>
                </div>

                ${errorDetails ? `
                <div class="error-list">
                    <h4>🔍 Technical Details</h4>
                    <pre style="background-color: #f8f9fa; padding: 10px; border-radius: 3px; overflow-x: auto;">${JSON.stringify(errorDetails, null, 2)}</pre>
                </div>
                ` : ''}

                ${specificErrors.length > 0 ? `
                <div class="error-list">
                    <h4>📋 Specific Errors (First 10)</h4>
                    <ul>
                        ${specificErrors.slice(0, 10).map(error => 
                            `<li><strong>AWB ${error.awb}:</strong> ${error.error}</li>`
                        ).join('')}
                    </ul>
                    ${specificErrors.length > 10 ? `<p><em>... and ${specificErrors.length - 10} more errors</em></p>` : ''}
                </div>
                ` : ''}

                <div style="margin-top: 30px; padding: 15px; background-color: #d1ecf1; border-radius: 5px;">
                    <h4>📋 Recommended Actions</h4>
                    <ul>
                        <li>Check the server logs for detailed error information</li>
                        <li>Verify database connectivity and API endpoints</li>
                        <li>Review Coverzy settings for any recent changes</li>
                        <li>Monitor the next scheduled run for auto-recovery</li>
                        <li>Check error logs table: <code>cron_error_logs</code></li>
                    </ul>
                </div>
            </div>

            <div class="footer">
                <p>LexCoverzy Automated Monitoring System</p>
                <p>This is an automated alert. Please do not reply to this email.</p>
            </div>
        </body>
        </html>
        `;

        // Create plain text version
        const textBody = `
CRON JOB ERROR ALERT
===================

Job Name: ${jobName}
Execution Date: ${executionDate}
Error Type: ${errorType}
Error Message: ${errorMessage}
Alert Time: ${new Date().toLocaleString()}

STATISTICS:
- Total Shipments: ${totalShipments}
- Processed: ${processedShipments}
- Failed: ${failedShipments}

${errorDetails ? `
TECHNICAL DETAILS:
${JSON.stringify(errorDetails, null, 2)}
` : ''}

${specificErrors.length > 0 ? `
SPECIFIC ERRORS (First 5):
${specificErrors.slice(0, 5).map(error => `- AWB ${error.awb}: ${error.error}`).join('\n')}
${specificErrors.length > 5 ? `... and ${specificErrors.length - 5} more errors` : ''}
` : ''}

RECOMMENDED ACTIONS:
- Check server logs for detailed information
- Verify database and API connectivity
- Review Coverzy settings
- Monitor next scheduled run
- Check cron_error_logs table

---
LexCoverzy Automated Monitoring System
        `;

        const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME;
        const adminEmails = emailSettings.adminEmails;
        
        if (!adminEmails || adminEmails.length === 0) {
            console.error('❌ Cannot send email: No admin emails found in coverzy_settings');
            return {
                success: false,
                error: 'No admin emails configured in coverzy_settings'
            };
        }
        
        const mailOptions = {
            from: `"LexCoverzy Alerts" <${fromAddress}>`,
            to: adminEmails.join(','), // Send to all admin emails
            subject: subject,
            text: textBody,
            html: htmlBody
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Error notification email sent successfully to ${adminEmails.length} recipients:`, info.messageId);
        
        return {
            success: true,
            messageId: info.messageId,
            response: info.response
        };

    } catch (error) {
        console.error('❌ Failed to send error notification email:', error.message);
        
        // Log email failure to console (since we can't rely on database here)
        console.error('Email Error Details:', {
            error: error.message,
            stack: error.stack,
            config: {
                host: process.env.MAIL_HOST,
                port: process.env.MAIL_PORT,
                secure: process.env.MAIL_ENCRYPTION === 'ssl',
                user: process.env.MAIL_USERNAME ? '***' : 'NOT_SET',
                fromAddress: process.env.MAIL_FROM_ADDRESS || 'NOT_SET'
            }
        });
        
        return {
            success: false,
            error: error.message
        };
    }
};



// Send daily summary email (success case)
const sendDailySummaryEmail = async (summaryData) => {
    try {
        // Check if email service is enabled
        const emailSettings = await getEmailSettings();
        
        if (!emailSettings) {
            console.log('❌ Email settings not found in database');
            return {
                success: false,
                error: 'Email settings not found in database'
            };
        }
        
        if (!emailSettings.emailEnabled) {
            console.log('📧 Email service is disabled - skipping daily summary');
            return {
                success: false,
                error: 'Email service is disabled',
                skipped: true
            };
        }
        
        const transporter = createEmailTransporter();
        
        const { 
            executionDate, 
            totalShipments, 
            validShipments, 
            processedShipments, 
            successfulShipments,
            failedValidation,
            failedProcessing
        } = summaryData;

        const subject = `✅ Daily Coverzy Processing Summary - ${executionDate}`;
        
        const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .header { background-color: #28a745; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .summary { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; }
                .stats { display: flex; justify-content: space-around; margin: 20px 0; }
                .stat-box { text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 5px; }
                .footer { background-color: #6c757d; color: white; padding: 15px; text-align: center; margin-top: 30px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>✅ Daily Processing Complete</h1>
                <p>Coverzy Shipments Successfully Processed</p>
            </div>
            
            <div class="content">
                <div class="summary">
                    <h3>Processing Summary</h3>
                    <p><strong>Execution Date:</strong> ${executionDate}</p>
                    <p><strong>Completion Time:</strong> ${new Date().toLocaleString()}</p>
                </div>

                <div class="stats">
                    <div class="stat-box">
                        <h4>📊 Total Found</h4>
                        <h2 style="color: #007bff;">${totalShipments}</h2>
                    </div>
                    <div class="stat-box">
                        <h4>✅ Valid</h4>
                        <h2 style="color: #28a745;">${validShipments}</h2>
                    </div>
                    <div class="stat-box">
                        <h4>🚀 Processed</h4>
                        <h2 style="color: #17a2b8;">${processedShipments}</h2>
                    </div>
                    <div class="stat-box">
                        <h4>💼 Successful</h4>
                        <h2 style="color: #28a745;">${successfulShipments}</h2>
                    </div>
                </div>

                <div style="margin-top: 20px; padding: 15px; background-color: #d4edda; border-radius: 5px;">
                    <h4>📈 Processing Efficiency</h4>
                    <p><strong>Validation Rate:</strong> ${totalShipments > 0 ? ((validShipments / totalShipments) * 100).toFixed(1) : 0}%</p>
                    <p><strong>Success Rate:</strong> ${processedShipments > 0 ? ((successfulShipments / processedShipments) * 100).toFixed(1) : 0}%</p>
                </div>
            </div>

            <div class="footer">
                <p>LexCoverzy Automated Processing System</p>
                <p>Next scheduled run: Tomorrow at 11:00 AM IST</p>
            </div>
        </body>
        </html>
        `;

        const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME;
        const adminEmails = emailSettings.adminEmails;
        
        if (!adminEmails || adminEmails.length === 0) {
            console.error('❌ Cannot send daily summary email: No admin emails found in coverzy_settings');
            return {
                success: false,
                error: 'No admin emails configured in coverzy_settings'
            };
        }
        
        const mailOptions = {
            from: `"LexCoverzy Reports" <${fromAddress}>`,
            to: adminEmails.join(','), // Send to all admin emails
            subject: subject,
            html: htmlBody
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Daily summary email sent successfully to ${adminEmails.length} recipients:`, info.messageId);
        
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error('❌ Failed to send daily summary email:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendCronErrorEmail,
    sendDailySummaryEmail,
    createEmailTransporter,
    getAdminEmail,
    getEmailSettings
};
