import './App.css';
import { useRef, useState, useCallback, useEffect } from 'react';
import { RealtimeTranscriber } from 'assemblyai/streaming';
import * as RecordRTC from 'recordrtc';

function App() {
  // Audio handling refs
  const realtimeTranscriber = useRef(null);
  const recorder = useRef(null);
  const audioPlayer = useRef(null);
  const audioContext = useRef(null);
  const audioSource = useRef(null);
  const processingInterval = useRef(null);
  const currentChunkIndex = useRef(0);
  const audioChunks = useRef([]);
  const processingTimeoutRef = useRef(null);
  const currentSpeakerRef = useRef('none');
  const lastProcessedIndex = useRef(0);
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscriptionStopped, setIsTranscriptionStopped] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [currentAccumulatingTranscript, setCurrentAccumulatingTranscript] = useState('');
  const [inputMode, setInputMode] = useState('microphone');
  const [audioFile, setAudioFile] = useState(null);
  const [isLLMProcessing, setIsLLMProcessing] = useState(false);
  const [callContext, setCallContext] = useState('');
  const [currentSpeaker, setCurrentSpeaker] = useState('none');
  
  // Sales assistant states
  const [conversationId] = useState(() => `conv_${Date.now()}`);
  const [summaryPoints, setSummaryPoints] = useState([]);
  const [bant, setBANT] = useState({
    budget: 'Not identified',
    authority: 'Not identified',
    need: 'Not identified',
    timeline: 'Not identified'
  });
  const [companyInfo, setCompanyInfo] = useState('Company not yet identified');
  const [salesReminders, setSalesReminders] = useState([]);
  const [objections, setObjections] = useState([]);

  useEffect(() => {
    currentSpeakerRef.current = currentSpeaker;
  }, [currentSpeaker]);

  const handleContextChange = (e) => {
    setCallContext(e.target.value);
  };

  const handleSpeakerChange = async (newSpeaker) => {
    if (realtimeTranscriber.current && currentSpeaker !== newSpeaker) {
      try {
        realtimeTranscriber.current.websocket.send(JSON.stringify({
          "force_end_utterance": true
        }));
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Error forcing utterance end:', error);
      }
    }
    setCurrentSpeaker(newSpeaker);
  };

  const processTranscriptUpdate = useCallback(async (newTranscript) => {
    if (!newTranscript.trim()) {
      if (!isTranscriptionStopped) {
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
        }
        processingTimeoutRef.current = setTimeout(() => {
          if (!isTranscriptionStopped && currentAccumulatingTranscript.trim()) {
            processTranscriptUpdate(currentAccumulatingTranscript);
          }
        }, 5000);
      }
      return;
    }
    
    const transcriptToProcess = newTranscript;
    setCurrentAccumulatingTranscript('');
    const labeledTranscript = transcriptToProcess;
    
    setIsLLMProcessing(true);
    try {
      const response = await fetch('http://localhost:8000/process-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: labeledTranscript,
          conversationId,
          callContext
        })
      });

      const updates = await response.json();
      
      if (updates.update_summary) {
        setSummaryPoints(prev => [...prev, updates.update_summary.new_point]);
      }
      if (updates.update_bant) {
        setBANT(prev => ({
          ...prev,
          ...updates.update_bant
        }));
      }
      if (updates.update_company_info) {
        setCompanyInfo(updates.update_company_info.companyInfo);
      }
      if (updates.update_sales_reminders) {
        setSalesReminders(prev => [...prev, updates.update_sales_reminders.new_reminder]);
      }
      // In processTranscriptUpdate, replace the objections handling code with this:
      if (updates.update_objections && updates.update_objections.new_objection) {
        let newObjection;
        if (typeof updates.update_objections.new_objection === 'string') {
          // Handle string case (though this shouldn't happen with new format)
          const match = updates.update_objections.new_objection.match(/<parameter name="objection">(.*)/);
          newObjection = {
            objection: match ? match[1] : updates.update_objections.new_objection,
            handling_strategy: updates.update_objections.handling_strategy || 'No strategy provided'
          };
        } else {
          // Handle object case (the new format)
          newObjection = {
            objection: updates.update_objections.new_objection.objection,
            handling_strategy: updates.update_objections.new_objection.handling_strategy
          };
        }
        
        setObjections(prev => [...prev, newObjection]);
      }

      if (!isTranscriptionStopped) {
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
        }
        processingTimeoutRef.current = setTimeout(() => {
          if (!isTranscriptionStopped && currentAccumulatingTranscript.trim()) {
            processTranscriptUpdate(currentAccumulatingTranscript);
          }
        }, 5000);
      }
    } catch (error) {
      console.error('Error processing transcript:', error);
    } finally {
      setIsLLMProcessing(false);
    }
  }, [conversationId, callContext, currentAccumulatingTranscript, isTranscriptionStopped]);

  useEffect(() => {
    if (!isTranscriptionStopped && !isLLMProcessing) {
      processTranscriptUpdate(currentAccumulatingTranscript);
    }
  }, [isLLMProcessing, currentAccumulatingTranscript, processTranscriptUpdate, isTranscriptionStopped]);

  const setupTranscriber = async () => {
    if (!realtimeTranscriber.current) {
      realtimeTranscriber.current = new RealtimeTranscriber({
        token: await getToken(),
        sampleRate: 16_000,
      });

      const texts = {};
      let lastSpeaker = null;
      
      realtimeTranscriber.current.on('transcript', transcript => {
        let displayMsg = '';  // For UI
        let newMsg = '';     // For new LLM content only
        
        // Only add non-empty text
        if (transcript.text.trim()) {
          texts[transcript.audio_start] = {
            text: transcript.text.trim(),
            speaker: currentSpeakerRef.current,
            index: Object.keys(texts).length,
            isFinal: transcript.message_type === 'FinalTranscript'
          };
        }
        
        const keys = Object.keys(texts);
        keys.sort((a, b) => a - b);
        
        // Build messages
        let isFirst = true;
        for (const key of keys) {
          if (texts[key] && texts[key].text.trim()) {
            const { text, speaker, index, isFinal } = texts[key];
            
            // Build display message (full transcript for UI)
            if (speaker !== lastSpeaker && !isFirst) {
              displayMsg += '\n';
            }
            if (isFirst || speaker !== lastSpeaker) {
              displayMsg += speaker === 'none' 
                ? ` ${text}`
                : ` <strong>${speaker === 'sales_rep' ? 'Sales Rep' : 'Customer'}:</strong> ${text}`;
            } else {
              displayMsg += ` ${text}`;
            }
            
            // Only add to new message if it's final transcript and new content
            if (isFinal && index > lastProcessedIndex.current && text.trim()) {
              const speakerPrefix = speaker === 'none' ? '' : 
                `${speaker === 'sales_rep' ? 'Sales Rep' : 'Customer'}: `;
              newMsg = speakerPrefix + text;
              lastProcessedIndex.current = index;
            }
            
            lastSpeaker = speaker;
            isFirst = false;
          }
        }
        
        setTranscript(displayMsg);
        
        // Only update accumulating transcript if we have new final content
        if (newMsg.trim() && transcript.message_type === 'FinalTranscript') {
          setCurrentAccumulatingTranscript(newMsg);
        }
      });

      realtimeTranscriber.current.on('error', event => {
        console.error(event);
        realtimeTranscriber.current.close();
        realtimeTranscriber.current = null;
      });

      realtimeTranscriber.current.on('close', (code, reason) => {
        console.log(`Connection closed: ${code} ${reason}`);
        realtimeTranscriber.current = null;
      });

      await realtimeTranscriber.current.connect();
    }
  };

  const cleanupResources = async (previousMode) => {
    try {
      setIsRecording(false);
      setIsTranscriptionStopped(true);
      setTranscript('');
      setCurrentAccumulatingTranscript('');
  
      if (realtimeTranscriber.current) {
        await realtimeTranscriber.current.close();
        realtimeTranscriber.current = null;
      }
  
      if (processingInterval.current) {
        clearInterval(processingInterval.current);
        processingInterval.current = null;
      }

      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }

      audioChunks.current = [];
      currentChunkIndex.current = 0;

      if (previousMode === 'microphone') {
        if (recorder.current) {
          recorder.current.stopRecording();
          recorder.current = null;
        }
      } else if (previousMode === 'file') {
        if (audioPlayer.current) {
          audioPlayer.current.removeEventListener('play', handleAudioPlaybackChange);
          audioPlayer.current.removeEventListener('pause', handleAudioPlaybackChange);
          audioPlayer.current.pause();
          audioPlayer.current.src = '';
          audioPlayer.current.currentTime = 0;
        }
        setAudioFile(null);
      }
  
      if (audioContext.current) {
        await audioContext.current.close();
        audioContext.current = null;
      }
    } catch (error) {
      console.error('Error cleaning up resources:', error);
    }
  };

  const handleModeChange = (e) => {
    const newMode = e.target.value;
    const previousMode = inputMode;
    setTranscript('');
    setCurrentAccumulatingTranscript('');
    setInputMode(newMode);
    cleanupResources(previousMode);
  };

  const getToken = async () => {
    const response = await fetch('http://localhost:8000/token');
    const data = await response.json();

    if (data.error) {
      alert(data.error);
    }

    return data.token;
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    setAudioFile(file);
    if (audioPlayer.current) {
      audioPlayer.current.src = URL.createObjectURL(file);
    }
  };

  const handleAudioPlaybackChange = async () => {
    if (audioPlayer.current.paused) {
      if (processingInterval.current) {
        clearInterval(processingInterval.current);
        processingInterval.current = null;
      }
      setIsRecording(false);
    } else {
      const currentTime = audioPlayer.current.currentTime;
      currentChunkIndex.current = Math.floor(currentTime * 10);
      
      processingInterval.current = setInterval(() => {
        if (currentChunkIndex.current < audioChunks.current.length) {
          if (realtimeTranscriber.current) {
            realtimeTranscriber.current.sendAudio(audioChunks.current[currentChunkIndex.current]);
          }
          currentChunkIndex.current++;
        } else {
          clearInterval(processingInterval.current);
          processingInterval.current = null;
        }
      }, 100);
      setIsRecording(true);
    }
  };

  const processAudioFile = async () => {
    if (!audioContext.current) {
      audioContext.current = new AudioContext({ sampleRate: 16000 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.current.decodeAudioData(arrayBuffer);
    
    const chunkSize = Math.floor(16000 * 0.1);
    const chunksCount = Math.ceil(audioBuffer.length / chunkSize);

    audioChunks.current = [];
    for (let i = 0; i < chunksCount; i++) {
      const startSample = i * chunkSize;
      const endSample = Math.min((i + 1) * chunkSize, audioBuffer.length);
      
      const channelData = audioBuffer.getChannelData(0).slice(startSample, endSample);
      
      const samples = new Int16Array(channelData.length);
      for (let j = 0; j < channelData.length; j++) {
        const s = Math.max(-1, Math.min(1, channelData[j]));
        samples[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      audioChunks.current.push(samples.buffer);
    }

    return audioBuffer.duration;
  };

  const startTranscription = async () => {
    await setupTranscriber();
    setIsTranscriptionStopped(false);
    setIsRecording(true);

    if (inputMode === 'microphone') {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          recorder.current = new RecordRTC(stream, {
            type: 'audio',
            mimeType: 'audio/webm;codecs=pcm',
            recorderType: RecordRTC.StereoAudioRecorder,
            timeSlice: 250,
            desiredSampRate: 16000,
            numberOfAudioChannels: 1,
            bufferSize: 4096,
            audioBitsPerSecond: 128000,
            ondataavailable: async (blob) => {
              if(!realtimeTranscriber.current) return;
              const buffer = await blob.arrayBuffer();
              realtimeTranscriber.current.sendAudio(buffer);
            },
          });
          recorder.current.startRecording();
        })
        .catch((err) => console.error(err));
    } else {
      await processAudioFile();
      
      audioPlayer.current.addEventListener('play', handleAudioPlaybackChange);
      audioPlayer.current.addEventListener('pause', handleAudioPlaybackChange);
      
      audioPlayer.current.play();
    }
  };

  const pauseTranscription = async (event) => {
    event.preventDefault();
    setIsRecording(false);
    
    if (inputMode === 'microphone' && recorder.current) {
      recorder.current.pauseRecording();
    } else {
      if (processingInterval.current) {
        clearInterval(processingInterval.current);
        processingInterval.current = null;
      }
      
      if (audioPlayer.current) {
        audioPlayer.current.pause();
      }
    }
  };

  const resumeTranscription = async () => {
    setIsRecording(true);
    
    if (inputMode === 'microphone' && recorder.current) {
      recorder.current.resumeRecording();
    } else if (audioPlayer.current) {
      audioPlayer.current.play();
    }
  };

  const stopTranscription = async () => {
    setIsTranscriptionStopped(true);
    setIsRecording(false);

    if (realtimeTranscriber.current) {
      await realtimeTranscriber.current.close();
      realtimeTranscriber.current = null;
    }

    if (inputMode === 'microphone' && recorder.current) {
      recorder.current.stopRecording();
      recorder.current = null;
    }

    if (audioPlayer.current) {
      audioPlayer.current.removeEventListener('play', handleAudioPlaybackChange);
      audioPlayer.current.removeEventListener('pause', handleAudioPlaybackChange);
      audioPlayer.current.pause();
      audioPlayer.current.src = '';
      audioPlayer.current.currentTime = 0;
    }

    if (audioContext.current) {
      await audioContext.current.close();
      audioContext.current = null;
    }

    audioChunks.current = [];
    currentChunkIndex.current = 0;
    setTranscript('');
    setCurrentAccumulatingTranscript('');
  };
  return (
    <div className="App">
      <header>
        <h1 className="header__title">Real-Time Sales Assistant</h1>
        <p className="header__sub-title">Powered by AssemblyAI and Claude</p>
      </header>

      <div className="context-input-container">
        <textarea
          className="context-input"
          placeholder="Enter any additional context about this sales call (optional)"
          value={callContext}
          onChange={handleContextChange}
        />
      </div>

      <div className="real-time-interface">
        <select 
          value={inputMode} 
          onChange={handleModeChange}
          className="real-time-interface__select"
        >
          <option value="microphone">Microphone</option>
          <option value="file">File Upload</option>
        </select>

        {inputMode === 'file' && (
          <div className="file-upload-container">
            <div className="file-requirements">
              <p className="file-requirements__text">
                Please note: For best results, use a 16kHz WAV file.
              </p>
              <p className="file-requirements__subtext">
                Other formats may not transcribe correctly.
              </p>
            </div>
            <input 
              type="file" 
              accept="audio/wav"
              onChange={handleFileUpload}
              className="file-upload-input"
            />
            <audio ref={audioPlayer} controls />
          </div>
        )}

        <p id="real-time-title" className="real-time-interface__title">
          {inputMode === 'microphone' ? 'Click start to begin recording!' : 'Upload an audio file and click play!'}
        </p>
        
        {isRecording ? (
          <button className="real-time-interface__button" onClick={pauseTranscription}>
            {inputMode === 'microphone' ? 'Pause recording' : 'Pause playing'}
          </button>
        ) : (
          <div className="button-group">
            <button 
              className="real-time-interface__button" 
              onClick={realtimeTranscriber.current ? resumeTranscription : startTranscription}
              disabled={inputMode === 'file' && !audioFile}
            >
              {realtimeTranscriber.current 
                ? (inputMode === 'microphone' ? 'Resume recording' : 'Resume playing')
                : (inputMode === 'microphone' ? 'Start recording' : 'Start playing')
              }
            </button>
            {realtimeTranscriber.current && (
              <button 
                className="real-time-interface__button real-time-interface__button--stop" 
                onClick={stopTranscription}
              >
                Stop completely
              </button>
            )}
          </div>
        )}

        <div className="speaker-labels">
          <h4>Speaker Label</h4>
          <div className="speaker-buttons">
            <label className={`speaker-button ${currentSpeaker === 'none' ? 'active' : ''}`}>
              <input
                type="radio"
                name="speaker"
                value="none"
                checked={currentSpeaker === 'none'}
                onChange={() => handleSpeakerChange('none')}
              />
              No Label
            </label>
            <label className={`speaker-button ${currentSpeaker === 'sales_rep' ? 'active' : ''}`}>
              <input
                type="radio"
                name="speaker"
                value="sales_rep"
                checked={currentSpeaker === 'sales_rep'}
                onChange={() => handleSpeakerChange('sales_rep')}
              />
              Sales Rep
            </label>
            <label className={`speaker-button ${currentSpeaker === 'customer' ? 'active' : ''}`}>
              <input
                type="radio"
                name="speaker"
                value="customer"
                checked={currentSpeaker === 'customer'}
                onChange={() => handleSpeakerChange('customer')}
              />
              Customer
            </label>
          </div>
        </div>
      </div>

      <div className="dashboard-container">
        <div className="dashboard-panel transcript-panel">
          <h3>Live Transcript</h3>
          <div 
            className="transcript-content"
            dangerouslySetInnerHTML={{ 
              __html: transcript || 'Waiting for speech...'
            }}
          />
        </div>

        <div className="dashboard-panel summary-panel">
          <h3>Conversation Summary</h3>
          <div className="summary-content">
            {summaryPoints.length > 0 ? (
              <ul className="bullet-list">
                {summaryPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            ) : (
              <p>Waiting for conversation...</p>
            )}
          </div>
        </div>

        <div className="dashboard-panel bant-panel">
          <h3>BANT Qualification</h3>
          <div className="bant-content">
            <div className="bant-item">
              <span className="bant-label">Budget:</span>
              <span className="bant-value">{bant.budget}</span>
            </div>
            <div className="bant-item">
              <span className="bant-label">Authority:</span>
              <span className="bant-value">{bant.authority}</span>
            </div>
            <div className="bant-item">
              <span className="bant-label">Need:</span>
              <span className="bant-value">{bant.need}</span>
            </div>
            <div className="bant-item">
              <span className="bant-label">Timeline:</span>
              <span className="bant-value">{bant.timeline}</span>
            </div>
          </div>
        </div>

        <div className="dashboard-panel company-panel">
          <h3>Company Information</h3>
          <div className="company-content">
            {companyInfo}
          </div>
        </div>

        <div className="dashboard-panel reminders-panel">
          <h3>Sales Reminders</h3>
          <div className="reminders-content">
            {salesReminders.length > 0 ? (
              <ul className="bullet-list">
                {salesReminders.map((reminder, index) => (
                  <li key={index}>{reminder}</li>
                ))}
              </ul>
            ) : (
              <p>Waiting for reminders...</p>
            )}
          </div>
        </div>

        <div className="dashboard-panel objections-panel">
          <h3>Customer Objections</h3>
          <div className="objections-content">
            {objections.length > 0 ? (
              <ul className="bullet-list">
                {objections.map((obj, index) => (
                  <li key={index} className="objection-item">
                    <strong>Objection:</strong> {obj.objection}
                    <br />
                    <strong>Strategy:</strong> {obj.handling_strategy}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No objections identified yet</p>
            )}
          </div>
        </div>
      </div>

      {isLLMProcessing && (
        <div className="processing-indicator">
          Processing conversation...
        </div>
      )}
    </div>
  );
}

export default App;