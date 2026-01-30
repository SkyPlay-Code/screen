const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const stream = require('stream');
const cors = require('cors');
require('dotenv').config(); // Loads variables from .env if running locally

const app = express();

// 1. CONFIGURATION
// Use the port Render assigns, or 5000 for local development
const PORT = process.env.PORT || 5000;

// Allow your frontend to talk to this backend
// In strict production, replace '*' with your Vercel URL (e.g., 'https://my-app.vercel.app')
app.use(cors({
    origin: "https://screen-skyplay.vercel.app/"
}));

// Configure Multer to hold files in memory (RAM) temporarily
// We limit file size to 50MB to prevent crashing the server
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// 2. AUTHENTICATION LOGIC
// This helper function determines if we are on Render or Localhost
const getDriveService = () => {
    let credentials;
    
    // Check if the JSON key is stored as an Environment Variable (Render/Production)
    if (process.env.GOOGLE_JSON_KEY) {
        try {
            credentials = JSON.parse(process.env.GOOGLE_JSON_KEY);
        } catch (error) {
            console.error('Error parsing GOOGLE_JSON_KEY:', error);
            throw new Error('Invalid Google JSON Key format');
        }
    } 
    // Fallback: Check for local file (Localhost development)
    else {
        try {
            credentials = require('./service-account.json');
        } catch (error) {
            console.error('Service account file not found.');
            throw new Error('Missing Google Credentials');
        }
    }

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    return google.drive({ version: 'v3', auth });
};

// 3. ROUTES

// Health Check Endpoint (Render uses this to know if your app is alive)
app.get('/', (req, res) => {
    res.send('Screen Recorder Backend is Running!');
});

// Upload Endpoint
app.post('/upload', upload.single('chunk'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const folderId = process.env.FOLDER_ID;
        if (!folderId) {
            return res.status(500).json({ error: 'Server misconfigured: Missing FOLDER_ID' });
        }

        const drive = getDriveService();

        // Convert the buffer (RAM) into a readable stream for Google
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const fileMetadata = {
            name: req.body.filename || `recording_${Date.now()}.webm`,
            parents: [folderId], // Upload to the specific folder
        };

        const media = {
            mimeType: 'video/webm',
            body: bufferStream,
        };

        // Stream the file to Google Drive
        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink',
        });

        console.log(`Uploaded: ${response.data.name} (${response.data.id})`);

        res.json({ 
            success: true, 
            fileId: response.data.id,
            link: response.data.webViewLink 
        });

    } catch (error) {
        console.error('Upload Error:', error.message);
        res.status(500).json({ error: 'Upload to Drive failed', details: error.message });
    }
});

// 4. START SERVER
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});