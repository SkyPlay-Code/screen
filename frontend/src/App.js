import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css'; // Assume basic styling

// CONFIGURATION
const API_URL = 'https://recorder-api-t4vv.onrender.com';
const CHUNK_DURATION = 300000; // Step 4: 5 Minutes (in ms)
const MAX_RETRIES = 3; // Step 6

function App() {
  // Step 1: Basic State
  const [isRecording, setIsRecording] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]); // Step 1: List of uploaded chunks
  const [timer, setTimer] = useState(0);
  
  // Refs for persistence across renders
  const mediaRecorderRef = useRef(null);
  const chunkSequence = useRef(0);
  const timerInterval = useRef(null);
  const uploadQueueRef = useRef([]); // To handle async queue processing logic
  const isUploadingRef = useRef(false);

  // Step 2: Auth Flow (Simplified)
  const handleLogin = async () => {
    const { data } = await axios.get(`${API_URL}/auth/url`);
    // In real app, redirect, then handle callback. 
    // For demo, assume we get code manually or via popup logic
    window.location.href = data.url; 
  };

  // Check for auth code in URL on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      axios.post(`${API_URL}/auth/token`, { code })
        .then(() => {
          setIsAuthenticated(true);
          window.history.replaceState({}, document.title, "/");
        })
        .catch(err => console.error(err));
    }
  }, []);

  useEffect(() => {
    // 1. Wake up the backend immediately on load
    fetch(`${API_URL}/`)
      .then(() => console.log("Backend woke up!"))
      .catch(err => console.log("Backend waking up...", err));
  }, []);

  // Step 3: Screen Capture
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          cursor: "always",
          // Step 9: Optimization - standard HD is usually sufficient
          width: { ideal: 1920 },
          height: { ideal: 1080 }, 
          frameRate: { ideal: 30 }
        },
        audio: true // Capture system audio
      });

      // Step 4: Set up chunked recording
      // Step 9: Use VP9 codec for better compression if available
      const options = { mimeType: 'video/webm; codecs=vp9' };
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined);

      recorder.ondataavailable = handleDataAvailable;
      
      // Stop recording if user clicks "Stop sharing" in browser UI
      stream.getVideoTracks()[0].onended = stopRecording;

      recorder.start(CHUNK_DURATION); 
      
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      chunkSequence.current = 0;
      
      // Step 8: Timer
      timerInterval.current = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);

    } catch (err) {
      console.error("Error starting capture:", err);
      alert("Permission denied or cancelled");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    clearInterval(timerInterval.current);
    setIsRecording(false);
  };

  // Step 5: Handle Chunk Creation
  const handleDataAvailable = (event) => {
    if (event.data.size > 0) {
      chunkSequence.current += 1;
      const blob = event.data;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `chunk_${String(chunkSequence.current).padStart(3, '0')}_${timestamp}.webm`;

      const chunkData = {
        id: Date.now(),
        blob: blob,
        filename: filename,
        status: 'pending', // pending, uploading, completed, error
        retries: 0
      };

      // Add to UI state
      setUploadQueue(prev => [...prev, chunkData]);
      
      // Add to processing ref
      uploadQueueRef.current.push(chunkData);
      
      // Trigger processor
      processQueue();
    }
  };

  // Step 6: Queue Processor & Retry Logic
  const processQueue = async () => {
    if (isUploadingRef.current || uploadQueueRef.current.length === 0) return;

    // Check internet connection
    if (!navigator.onLine) {
        console.log("Offline: Pausing uploads");
        setTimeout(processQueue, 5000);
        return;
    }

    isUploadingRef.current = true;
    const currentChunk = uploadQueueRef.current[0];

    // Update UI Status
    updateChunkStatus(currentChunk.id, 'uploading');

    const formData = new FormData();
    formData.append('chunk', currentChunk.blob);
    formData.append('filename', currentChunk.filename);

    try {
      await axios.post(`${API_URL}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Success
      updateChunkStatus(currentChunk.id, 'completed');
      uploadQueueRef.current.shift(); // Remove from queue
    } catch (error) {
      console.error("Upload failed", error);
      
      if (currentChunk.retries < MAX_RETRIES) {
        currentChunk.retries += 1;
        updateChunkStatus(currentChunk.id, `retry (${currentChunk.retries})`);
        // Exponential backoff wait
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, currentChunk.retries)));
      } else {
        // Failed permanently
        updateChunkStatus(currentChunk.id, 'failed');
        uploadQueueRef.current.shift(); // Remove to prevent blocking, or keep for manual retry
      }
    } finally {
      isUploadingRef.current = false;
      processQueue(); // Process next
    }
  };

  const updateChunkStatus = (id, status) => {
    setUploadQueue(prev => prev.map(item => 
      item.id === id ? { ...item, status } : item
    ));
  };

  // Step 8: UI Formatting
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="container">
      <h1>Cloud Screen Recorder</h1>
      
      {/* Step 1: Controls & Status */}
      <div className="controls">
        {!isAuthenticated ? (
          <button onClick={handleLogin} className="btn-google">Connect Google Drive</button>
        ) : (
          <>
            {!isRecording ? (
              <button onClick={startRecording} className="btn-start">Start Recording</button>
            ) : (
              <button onClick={stopRecording} className="btn-stop">Stop Recording</button>
            )}
            <div className="timer">Time: {formatTime(timer)}</div>
            <div className="status">Status: {isRecording ? 'Recording & Uploading...' : 'Idle'}</div>
          </>
        )}
      </div>

      {/* Step 1: Upload List */}
      <div className="upload-list">
        <h3>Upload Queue</h3>
        {uploadQueue.length === 0 && <p className="empty-msg">No uploads yet.</p>}
        {uploadQueue.map(chunk => (
          <div key={chunk.id} className={`chunk-item ${chunk.status}`}>
            <span>{chunk.filename}</span>
            <span className="badge">{chunk.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;