//================= CONFIG =================
// Global Variables
let websocket_uri = 'ws://127.0.0.1:9001';
//let websocket_uri = 'ws://172.16.0.17:9001';
let bufferSize = 4096,
    AudioContext,
    context,
    processor,
    input,
    globalStream,
    websocket,
    isMicPaused = false; // Track microphone state;

// Initialize WebSocket
initWebSocket();

//================= RECORDING =================
function startRecording() {
  if (globalStream) {
    console.log("Resuming microphone...");
    isMicPaused = false;
    globalStream.getTracks().forEach(track => track.enabled = true); // Enable mic input
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
      globalStream = stream;
      isMicPaused = false;

      AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext({ latencyHint: 'interactive' });
      processor = context.createScriptProcessor(bufferSize, 1, 1);
      processor.connect(context.destination);
      context.resume();

      input = context.createMediaStreamSource(globalStream);
      input.connect(processor);

      processor.onaudioprocess = function (e) {
        if (!isMicPaused) {
          let left = e.inputBuffer.getChannelData(0);
          let left16 = downsampleBuffer(left, 44100, 16000);
          websocket.send(left16);
        }
      };
    })
    .catch(error => console.error("Microphone access error:", error));
}

function pauseRecording() {
  if (globalStream) {
    console.log("Pausing microphone...");
    isMicPaused = true;
    globalStream.getTracks().forEach(track => track.enabled = false); // Disable mic input
  }
}

function stopRecording() {
  if (globalStream) {
    console.log("Stopping microphone...");
    isMicPaused = false;
    globalStream.getTracks().forEach(track => track.stop()); // Stop and release the stream
    globalStream = null;
  }
  if (context) {
    input.disconnect();
    processor.disconnect();
    context.close().then(() => {
      input = null;
      processor = null;
      context = null;
      AudioContext = null;
    });
  }
}

//================= WEBSOCKET =================
function initWebSocket() {
    // Create WebSocket
    websocket = new WebSocket(websocket_uri);
    //console.log("Websocket created...");
    let currentTranscriptionDiv = null;
  
    // WebSocket Definitions: executed when triggered webSocketStatus
    websocket.onopen = function() {
      console.log("connected to server");
      //websocket.send("CONNECTED TO YOU");
      document.getElementById("webSocketStatus").innerHTML = 'Connected';
    }
    
    websocket.onclose = function(e) {
      console.log("connection closed (" + e.code + ")");
      document.getElementById("webSocketStatus").innerHTML = 'Not Connected';
    }
    
    websocket.onmessage = function (e) {
      console.log(e.data);

      if (typeof e.data === 'string') {
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
            if(result.speaker == 'Fawkes') {
              playTextToSpeech(result.transcript);
            }
          }

        } catch (error) {
          console.error("Error parsing JSON: " + error);
        }
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
} // closes function downsampleBuffer()

//================= TEXT-TO-SPEECH =================
//This function uses Google Speech API SpeechSynthesisUtterance, may reduce bandwidth usage
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

// Ensure voices are loaded before calling playTextToSpeech
window.speechSynthesis.onvoiceschanged = function () {
  console.log("Voices loaded:", speechSynthesis.getVoices());
};
