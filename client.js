//================= CONFIG =================
// Global Variables
//let websocket_uri = 'ws://127.0.0.1:9001';
//let websocket_uri = 'ws://172.16.0.41:9001';

let websocket_uri = 'ws://138.197.175.164:9001';
//common PCM sample rates are 16000, 22050, 44100
let bufferSize = 4096,
  micAudioContext, playbackAudioContext,
  sampleRate = 16000, offlineSpeech = false,
  websocket, globalStream, processor, input,
  isMicPaused = false, // Track microphone state;
  audioQueue = [],
  isPlaying = false;
let lastChunkTime = performance.now();

// Initialize WebSocket
if (!websocket || websocket.readyState !== WebSocket.OPEN) {
  initWebSocket();
}

//================= RECORDING & PLAYBACK =================
// Open channel: start recording and enable playback
function openChannel() {
  // Mic needs its own audio context w/ sample rate defined by browser/microphone, later downsampled
  if (!micAudioContext) {
    micAudioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  }
  // Playback needs its own audio context forced to match the expected incoming sample rate
  if (!playbackAudioContext) {
    playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sampleRate });
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    globalStream = stream;
    isMicPaused = false;

    input = micAudioContext.createMediaStreamSource(globalStream);
    processor = micAudioContext.createScriptProcessor(4096, 1, 1);
    input.connect(processor);
    processor.connect(micAudioContext.destination);

    processor.onaudioprocess = function (e) {
      if (!isMicPaused) {
        let left = e.inputBuffer.getChannelData(0);
        let left16 = downsampleBuffer(left, micAudioContext.sampleRate, sampleRate);
        websocket.send(left16);
      }
    };

    console.log("Microphone started.");
  }).catch(error => console.error("Microphone access error:", error));
}

function pauseMic() {
  if (globalStream) {
    console.log("Pausing microphone...");
    isMicPaused = true;
    globalStream.getTracks().forEach(track => (track.enabled = false)); // Disable mic input
  }
}

function resumeMic() {
  if (globalStream) {
    console.log("Resuming microphone...");
    isMicPaused = false;
    globalStream.getTracks().forEach(track => (track.enabled = true)); // Enable mic input
  }
}

// Close channel: stop recording and disable playback
function closeChannel() {
  if (globalStream) {
    globalStream.getTracks().forEach(track => track.stop());
    globalStream = null;
  }

  if (processor) {
    input.disconnect();
    processor.disconnect();
    processor = null;
  }

  if (micAudioContext || playbackAudioContext) {
    micAudioContext.suspend();
    playbackAudioContext.suspend();
  }

  if (websocket) {
    websocket.close();
    websocket = null;
  }

  isMicPaused = false;
  isPlaying = false;
  audioQueue = [];
  console.log("Microphone and WebSocket disconnected.");
}

//================= WEBSOCKET =================
function initWebSocket() {
  // Create WebSocket
  websocket = new WebSocket(websocket_uri);
  websocket.binaryType = "arraybuffer";  // Forces binary ArrayBuffer mode
  //websocket.binaryType = "blob";  // Forces binary blob mode
  let currentTranscriptionDiv = null;

  // WebSocket Definitions: executed when triggered webSocketStatus
  websocket.onopen = function () {
    console.log("connected to server");
    // If using client-side TTS, tell server not to bother with TTS on its end
    if (offlineSpeech) {
      websocket.send("clientSideTTS");
    }
    document.getElementById("webSocketStatus").innerHTML = 'Connected';
  }

  websocket.onclose = function (e) {
    console.log("connection closed (" + e.code + ")");
    document.getElementById("webSocketStatus").innerHTML = 'Not Connected';
  }

  websocket.onmessage = function (e) {
    console.log(e.data);

    if (typeof e.data === 'string') {
      //console.log("Received text message:", e.data);
      try {
        let result = JSON.parse(e.data);  // Parse incoming JSON message

        if (result.error) {
          console.error("Error: " + result.error);
          return;
        }

        let transcriptionContainer = document.getElementById("transcription");

        // If we don't have a div yet, create one
        if (!currentTranscriptionDiv) {
          currentTranscriptionDiv = document.createElement("div");
          console.log('created new transcription div awaiting initial speaker');
          transcriptionContainer.appendChild(currentTranscriptionDiv);
        }

        // Create separate span elements for the speaker and the transcript
        let speakerSpan = document.createElement("span");
        let transcriptSpan = document.createElement("span");

        // Set the text content
        speakerSpan.textContent = result.speaker + ': ';
        transcriptSpan.textContent = result.transcript;

        // Apply color based on speaker confidence
        if (result.speaker_confidence === 'uncertain') {
          speakerSpan.style.color = '#C0C0C0'; // Silver
        } else {
          speakerSpan.style.color = '#000000'; // Black
        }

        // Apply color based on ASR confidence
        if (result.asr_confidence === 'uncertain') {
          transcriptSpan.style.color = '#C0C0C0'; // Silver
        } else {
          transcriptSpan.style.color = '#000000'; // Black
        }

        // Update the current div with the latest transcription
        //currentTranscriptionDiv.innerHTML = result.speaker + ': ' + result.transcript;
        // Clear previous content and append the new styled spans
        currentTranscriptionDiv.innerHTML = ''; // Clear the content for the new spans
        currentTranscriptionDiv.appendChild(speakerSpan);
        currentTranscriptionDiv.appendChild(transcriptSpan);

        // If "final" is true, create a new div for the next speaker
        if (result.final) {
          currentTranscriptionDiv = document.createElement("div");
          console.log('created new transcription div awaiting next speaker');
          transcriptionContainer.appendChild(currentTranscriptionDiv);

          // Auto-scroll to bottom to show latest message
          let container = document.getElementById('transcription-container');
          container.scrollTop = container.scrollHeight;

          if (offlineSpeech && result.speaker == 'Fawkes') {
            playTextToSpeech(result.transcript);
          }
        }

      } catch (error) {
        console.error("Error parsing JSON: " + error);
      }
    } else if (e.data instanceof ArrayBuffer) {
      //console.log(`Receiving ArrayBuffer of size: ${e.data.byteLength}`);
      //let now = performance.now();
      //let gap = now - lastChunkTime;  // Time difference between chunks
      //lastChunkTime = now;  // Update last received time
      //console.log(`Received audio chunk at ${now.toFixed(2)} ms (gap: ${gap.toFixed(2)} ms)`);
      if (!offlineSpeech) {
        processAudioData(e);
      }
    } else if (e.data instanceof Blob) {
      console.log("Receiving Blob data");
      if (!offlineSpeech) {
        return;
        // Blob data will likely need a different routine
      }
    } else {
      console.log(`Unexpected data type received: ${typeof e.data}`);
    }
  };
}

//================= AUDIO PROCESSING =================
function downsampleBuffer(buffer, inSampleRate, outSampleRate) {
  if (outSampleRate == inSampleRate) {
    return buffer;
  }
  if (outSampleRate > inSampleRate) {
    throw 'downsampling rate should be smaller than original sample rate';
  }
  var sampleRateRatio = inSampleRate / outSampleRate;
  var newLength = Math.round(buffer.length / sampleRateRatio);
  var result = new Int16Array(newLength);
  var offsetResult = 0;
  var offsetBuffer = 0;
  while (offsetResult < result.length) {
    var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    var accum = 0,
      count = 0;
    for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = Math.min(1, accum / count) * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result.buffer;
}

//================= TEXT-TO-SPEECH LOCAL SOLUTION =================
//This function uses Google Speech API SpeechSynthesisUtterance, this should not use any bandwidth at all after initial load
//This could be a good default for clients with poor internet connections incapable of full VoIP
function playTextToSpeech(text) {
  let speech = new SpeechSynthesisUtterance(text);
  let voices = speechSynthesis.getVoices();
  let selectedVoice = voices.find(voice => voice.name === "Aaron" && voice.lang === "en-US");

  if (selectedVoice) {
    speech.voice = selectedVoice;
  } else {
    console.warn("Aaron (en-US) voice not found. Using default voice.");
  }

  speech.onstart = function () {
    console.log("Speech started, pausing microphone...");
    pauseMic(); // Now using pauseRecording() instead of stopping completely
  };

  speech.onend = function () {
    console.log("Speech ended, resuming microphone...");
    resumeMic(); // Resumes without permission prompt
  };

  window.speechSynthesis.speak(speech);
}
/** Ensure voices are loaded before calling playTextToSpeech
  Could cause program hang on slow connections, otherwise behavior defaults
  to built-in voice automatically switching when other voices load */
window.speechSynthesis.onvoiceschanged = function () {
  console.log("Voices loaded:", speechSynthesis.getVoices());
};

//================= TEXT-TO-SPEECH NETWORK SOLUTION =================
//This solution plays audio live as it streams over websocket, lets server choose voice, inflections, etc
function processAudioData(event) {
  let data = event.data;

  // Check if the received data is a valid PCM chunk
  if (data.byteLength % 2 !== 0) {
    let textDecoder = new TextDecoder("utf-8");
    let decodedString = textDecoder.decode(data);
    // if not PCM chunk it may be EOF signal
    if (decodedString.trim() === "EOF") {
      console.log("End of audio stream.");
      return; // Stop processing further
    }

    console.warn("Received malformed audio chunk, skipping.");
    return;
  }

  let int16Array = new Int16Array(data); // Convert raw PCM to Int16Array
  let float32Array = new Float32Array(int16Array.length);

  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0; // Convert to Float32
  }

  audioQueue.push(float32Array);
  if (!isPlaying) {
    playAudio();
  }
}

function playAudio() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  let buffer = playbackAudioContext.createBuffer(1, audioQueue[0].length, sampleRate);
  buffer.copyToChannel(audioQueue.shift(), 0);

  let source = playbackAudioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackAudioContext.destination);
  source.start();

  source.onended = () => playAudio();
}