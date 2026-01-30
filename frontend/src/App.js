import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// CONFIGURATION
// Ensure this is your RENDER URL (No trailing slash)
const API_URL = 'https://recorder-api-t4vv.onrender.com'; 
const CHUNK_DURATION = 300000; // 5 Minutes
const MAX_RETRIES = 3; 

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]); 
  const [timer, setTimer] = useState(0);
  const [backendStatus, setBackendStatus] = useState("Connecting...");
  
  const mediaRecorderRef = useRef(null);
  const chunkSequence = useRef(0);
  const timerInterval = useRef(null);
  const uploadQueueRef = useRef([]); 
  const isUploadingRef = useRef(false);

  // 1. Wake up backend on load
  useEffect(() => {
    axios.get(`${API_URL}/`)
      .then(() => setBackendStatus("Ready"))
      .catch(() => setBackendStatus("Backend Sleeping (Waking up...)"));
  }, []);

  // 2. Start Recording (No Login Required anymore)
  const startRecording = async () => {
    // 1. Mobile Check
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
       // On Mobile, we often can't do "getDisplayMedia" reliably
       // So we ask user if they want to use Camera instead (which works everywhere)
       const confirmCamera = window.confirm("Screen recording is difficult on mobile browsers. Switch to Camera recording?");
       
       if (confirmCamera) {
         try {
           const stream = await navigator.mediaDevices.getUserMedia({
             video: true,
             audio: true
           });
           // SUCCESS: Start Recording Camera
           startStream(stream);
           return;
         } catch(err) {
           alert("Camera permission denied.");
           return;
         }
       }
       // If they say NO, we try screen recording anyway (might work on Android)
    }

    // 2. Standard Screen Recording (Desktop / Android Chrome)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: true 
      });
      // SUCCESS: Start Recording Screen
      startStream(stream);

    } catch (err) {
      console.error("Error starting capture:", err);
      alert("Could not start recording. Note: iPhones generally do not allow screen recording from websites.");
    }
  };

  // Helper function to handle the stream once we get it
  const startStream = (stream) => {
    const options = { mimeType: 'video/webm; codecs=vp9' };
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined);

    recorder.ondataavailable = handleDataAvailable;
    stream.getVideoTracks()[0].onended = stopRecording;

    recorder.start(CHUNK_DURATION); 
    
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    chunkSequence.current = 0;
    
    timerInterval.current = setInterval(() => {
      setTimer(t => t + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    clearInterval(timerInterval.current);
    setIsRecording(false);
  };

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
        status: 'pending', 
        retries: 0
      };

      setUploadQueue(prev => [...prev, chunkData]);
      uploadQueueRef.current.push(chunkData);
      processQueue();
    }
  };

  const processQueue = async () => {
    if (isUploadingRef.current || uploadQueueRef.current.length === 0) return;

    if (!navigator.onLine) {
        setTimeout(processQueue, 5000);
        return;
    }

    isUploadingRef.current = true;
    const currentChunk = uploadQueueRef.current[0];
    updateChunkStatus(currentChunk.id, 'uploading');

    const formData = new FormData();
    formData.append('chunk', currentChunk.blob);
    formData.append('filename', currentChunk.filename);

    try {
      // Direct upload to the endpoint
      await axios.post(`${API_URL}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      updateChunkStatus(currentChunk.id, 'completed');
      uploadQueueRef.current.shift(); 
    } catch (error) {
      console.error("Upload failed", error);
      if (currentChunk.retries < MAX_RETRIES) {
        currentChunk.retries += 1;
        updateChunkStatus(currentChunk.id, `retry (${currentChunk.retries})`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, currentChunk.retries)));
      } else {
        updateChunkStatus(currentChunk.id, 'failed');
        uploadQueueRef.current.shift(); 
      }
    } finally {
      isUploadingRef.current = false;
      processQueue(); 
    }
  };

  const updateChunkStatus = (id, status) => {
    setUploadQueue(prev => prev.map(item => 
      item.id === id ? { ...item, status } : item
    ));
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="container">
      <h1>Cloud Recorder</h1>
      
      <div className="system-status">
        Status: <strong>{backendStatus}</strong>
      </div>
      
      <div className="controls">
        {isRecording && <div className="timer-wrapper">
          <span className="recording-indicator"></span>
          <span className="timer">{formatTime(timer)}</span>
        </div>}
        
        {!isRecording ? (
          <button onClick={startRecording} className="btn-start">
            Launch Capture
          </button>
        ) : (
          <button onClick={stopRecording} className="btn-stop">
            Terminate
          </button>
        )}
        
        {!isRecording && timer === 0 && (
          <p style={{fontWeight: 'bold'}}>Ready to beam to Drive?</p>
        )}
      </div>
      
      <div className="upload-list">
        <h3>Live Feed Chunks</h3>
        {uploadQueue.length === 0 && (
          <div className="chunk-item" style={{justifyContent: 'center', borderStyle: 'dashed'}}>
            Waiting for first chunk...
          </div>
        )}
        {uploadQueue.map(chunk => (
          <div key={chunk.id} className={`chunk-item ${chunk.status}`}>
            <span>{chunk.filename.substring(0, 20)}...</span>
            <span className="badge">{chunk.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;