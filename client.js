//================= CONFIG =================
// Global Variables
let websocket_uri = 'ws://127.0.0.1:9001';
//let websocket_uri = 'ws://172.16.0.17:9001';
let bufferSize = 4096,
    audioContext, websocket, globalStream, processor, input,
    isProcessingAudio = false,
    context,
    isMicPaused = false, // Track microphone state;
    audioQueue = [],
    isPlaying = false;

//================= RECORDING & PLAYBACK =================
// Open channel: start recording and enable playback
function openChannel() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  }

  // Initialize WebSocket
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    initWebSocket();
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    globalStream = stream;
    isMicPaused = false;

    input = audioContext.createMediaStreamSource(globalStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    input.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = function (e) {
      if (!isMicPaused) {
        let left = e.inputBuffer.getChannelData(0);
        let left16 = downsampleBuffer(left, 44100, 16000);
        websocket.send(left16);
      }
    };

    console.log("Microphone started.");
  }).catch(error => console.error("Microphone access error:", error));
}

function pauseRecording() {
  if (globalStream) {
    console.log("Pausing microphone...");
    isMicPaused = true;
    globalStream.getTracks().forEach(track => (track.enabled = false)); // Disable mic input
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

  if (audioContext) {
    audioContext.suspend();
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
    //console.log("Websocket created...");
    websocket.binaryType = "arraybuffer";  // Forces binary mode!
    let currentTranscriptionDiv = null;
  
    // WebSocket Definitions: executed when triggered webSocketStatus
    websocket.onopen = function() {
      console.log("connected to server");
      //websocket.send("CONNECTED TO YOU");
      document.getElementById("webSocketStatus").innerHTML = 'Connected';
      //setupAudioContext();
    }
    
    websocket.onclose = function(e) {
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

          // Update the current div with the latest transcription
          currentTranscriptionDiv.innerHTML = result.speaker + ': ' + result.transcript;

          // If "final" is true, create a new div for the next speaker
          if (result.final) {
            currentTranscriptionDiv = document.createElement("div");
            console.log('created new transcription div awaiting next speaker');
            transcriptionContainer.appendChild(currentTranscriptionDiv);
            //if(result.speaker == 'Fawkes') {
            //  playTextToSpeech(result.transcript);
            //}
          }

        } catch (error) {
          console.error("Error parsing JSON: " + error);
        }
      } else if (e.data instanceof ArrayBuffer) {
          //console.log(`Receiving ArrayBuffer of size: ${e.data.byteLength}`);
          console.log("Receiving arraybuffer")
          //playAudioStream(e.data);
          audioQueue.push(e.data);
          if (!isPlaying) processAudioQueue(); // Start playback if idle
      } else if (e.data instanceof Blob) {
          console.log("Receiving Blob data");
          /**let reader = new FileReader();
          reader.readAsArrayBuffer(e.data);
          reader.onloadend = function () {
            playAudioStream(reader.result);
          };*/
      } else {
        //console.log(`Unexpected data type received: ${typeof e.data}`);
        console.log("unexpected data type received")
      }
    };
}

//================= AUDIO PROCESSING =================
function downsampleBuffer (buffer, sampleRate, outSampleRate) {
    if (outSampleRate == sampleRate) {
      return buffer;
    }
    if (outSampleRate > sampleRate) {
      throw 'downsampling rate show be smaller than original sample rate';
    }
    var sampleRateRatio = sampleRate / outSampleRate;
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
    pauseRecording(); // Now using pauseRecording() instead of stopping completely
  };

  speech.onend = function () {
    console.log("Speech ended, resuming microphone...");
    startRecording(); // Resumes without permission prompt
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
// Process and play queued audio chunks
async function processAudioQueue() {
  if (audioQueue.length === 0 || !audioContext) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  let chunk = audioQueue.shift();

  console.log("Received data type:", typeof chunk, "Size:", chunk.byteLength);

  audioContext.decodeAudioData(chunk, function (buffer) {
    let source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
    console.log("Playing audio chunk...");

    source.onended = function () {
      processAudioQueue();
    };
  }, function (error) {
    console.error("Error decoding audio chunk:", error);
  });
}

/**async function processAudioQueue() {
  if (audioQueue.length === 0 || isProcessingAudio) {
    return;
  }
  isProcessingAudio = true;

  let audioBuffer = []; // Store chunks
  let mediaSource = new MediaSource();
  let audio = new Audio();
  audio.src = URL.createObjectURL(mediaSource);

  mediaSource.addEventListener("sourceopen", async () => {
    let sourceBuffer = mediaSource.addSourceBuffer('audio/wav'); // Set WAV format

    while (audioQueue.length > 0) {
      let chunk = audioQueue.shift();

      // Check for EOF marker
      if (chunk === "EOF") {
        console.log("End of audio stream received.");
        break;
      }

      if (chunk instanceof Blob) {
        chunk = await chunk.arrayBuffer(); // Convert Blob to ArrayBuffer
      }

      audioBuffer.push(chunk);
    }

    // Merge chunks into a single buffer
    let completeBuffer = concatenateAudioChunks(audioBuffer);

    // Append buffer for playback
    sourceBuffer.appendBuffer(completeBuffer);
    audio.play();
  });

  audio.addEventListener("ended", () => {
    isProcessingAudio = false;
    processAudioQueue(); // Process next audio if available
  });
}*/

/**
 * Helper function to concatenate audio chunks into a single buffer.
 */
/**function concatenateAudioChunks(chunks) {
  let totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  let mergedBuffer = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach(chunk => {
    mergedBuffer.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  });

  return mergedBuffer.buffer; // Return as ArrayBuffer
}*/

