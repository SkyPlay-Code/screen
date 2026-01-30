const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const stream = require('stream');
const cors = require('cors');

const app = express();

// Set CORS to your Vercel URL (NO SLASH)
app.use(cors({
    origin: 'https://screen-azure.vercel.app'
}));

const PORT = process.env.PORT || 10000;
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 60 * 1024 * 1024 } // 60MB limit
});

// 1. Setup the Google Auth using your variables
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// 2. The Upload Route
app.post('/upload', upload.single('chunk'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file.");

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const response = await drive.files.create({
      requestBody: {
        name: req.body.filename || `chunk_${Date.now()}.webm`,
        parents: [process.env.FOLDER_ID]
      },
      media: {
        mimeType: 'video/webm',
        body: bufferStream
      }
    });

    console.log("Success! File ID:", response.data.id);
    res.json({ success: true, id: response.data.id });
  } catch (error) {
    console.error("Upload Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.send("Recording Backend is Online (Personal Account Mode)"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));