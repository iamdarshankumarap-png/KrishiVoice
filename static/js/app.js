let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let isBrowserRecognizing = false;
let recordingStartedAt = 0;
let previewUrl;
let speechRecognition;

const micButton = document.getElementById("micButton");
const micTitle = document.getElementById("micTitle");
const micStatus = document.getElementById("micStatus");
const askButton = document.getElementById("sendButton");
const questionInput = document.getElementById("question");
const transcriptBox = document.getElementById("transcript");
const answerBox = document.getElementById("response");
const languageSelect = document.getElementById("language");
const locationInput = document.getElementById("location");
const cropInput = document.getElementById("crop");
const cropImage = document.getElementById("cropImage");
const chooseImageButton = document.getElementById("chooseImageButton");
const imagePreview = document.getElementById("imagePreview");
const previewWrap = document.getElementById("previewWrap");
const imageName = document.getElementById("imageName");
const analyzeImageButton = document.getElementById("analyzeImageButton");
const statusMessage = document.getElementById("statusMessage");
const audioPlayer = document.getElementById("audioPlayer");
const listenButton = document.getElementById("listenButton");
const answerBadge = document.getElementById("answerBadge");
const resultCard = document.getElementById("resultCard");
let latestAnswer = "";
let activeRequest = false;
let speechRequestId = 0;
let isRequestingMicrophone = false;

function getSelectedLanguage() {
    return languageSelect.value;
}

function setStatus(message, type = "error") {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("success", type === "success");
    statusMessage.hidden = !message;
}

function getFarmDetails() {
    return {
        crop: cropInput.value.trim(),
        location: locationInput.value.trim()
    };
}

async function readResponse(response) {
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error("The server returned an unexpected response. Please try again.");
    }

    if (!response.ok) {
        throw new Error(result.error || "Something went wrong. Please try again.");
    }
    return result;
}

function setBusy(busy, label = "") {
    activeRequest = busy;
    askButton.disabled = busy;
    analyzeImageButton.disabled = busy;
    micButton.disabled = busy;
    resultCard.classList.toggle("is-loading", busy);
    answerBadge.classList.toggle("is-thinking", busy);
    if (busy) {
        answerBadge.innerHTML = '<span class="thinking-dot"></span> ' + label;
    }
    askButton.innerHTML = busy && label === "Writing your answer..."
        ? "Thinking..."
        : 'Ask KrishiVoice <span aria-hidden="true">→</span>';
    analyzeImageButton.innerHTML = busy && label === "Looking at your photo..."
        ? "Analyzing..."
        : 'Analyze photo <span aria-hidden="true">→</span>';
}

function clearAudio() {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer.hidden = true;
    if (audioPlayer.dataset.objectUrl) {
        URL.revokeObjectURL(audioPlayer.dataset.objectUrl);
        delete audioPlayer.dataset.objectUrl;
    }
}

async function consumeTextStream(response, onText) {
    if (!response.ok) {
        const result = await readResponse(response);
        throw new Error(result.error || "Something went wrong. Please try again.");
    }
    if (!response.body) {
        throw new Error("Live answers aren’t supported by this browser. Please reload and try again.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete = false;
    let streamError = "";
    let answer = "";

    function processEvent(eventText) {
        const data = eventText.split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
        if (!data) {
            return;
        }

        const event = JSON.parse(data);
        if (event.error) {
            streamError = event.error;
        }
        if (event.text) {
            answer += event.text;
            onText(event.text, answer);
        }
        if (event.done) {
            complete = true;
        }
    }

    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const events = buffer.split("\n\n");
            buffer = events.pop();
            for (const eventText of events) {
                processEvent(eventText);
            }
            if (done) {
                break;
            }
        }
        if (buffer.trim()) {
            processEvent(buffer);
        }
    } finally {
        reader.releaseLock();
    }

    if (streamError) {
        throw new Error(streamError);
    }
    if (!complete) {
        throw new Error("The answer stream ended unexpectedly. Please try again.");
    }
    if (!answer.trim()) {
        throw new Error("No answer was returned. Please try again.");
    }
    return answer;
}

async function askQuestion(question = questionInput.value.trim()) {
    if (activeRequest) {
        return;
    }
    if (!question) {
        setStatus("Please enter or speak a farming question.");
        questionInput.focus();
        return;
    }
    if (question.length > 2000) {
        setStatus("Keep your question under 2,000 characters.");
        questionInput.focus();
        return;
    }

    setStatus("");
    setBusy(true, "Writing your answer...");
    clearAudio();
    speechRequestId += 1;
    latestAnswer = "";
    listenButton.disabled = true;
    answerBox.textContent = "Thinking through your question...";
    answerBox.classList.add("result-placeholder");
    transcriptBox.textContent = question;
    transcriptBox.classList.remove("result-placeholder");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch("/api/ask/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question,
                language: getSelectedLanguage(),
                ...getFarmDetails()
            }),
            signal: controller.signal
        });
        latestAnswer = await consumeTextStream(response, (_text, answer) => {
            answerBox.textContent = answer;
            answerBox.classList.remove("result-placeholder");
        });
        listenButton.disabled = !latestAnswer;
        answerBadge.innerHTML = '<span class="online-dot"></span> Answer ready';
        if (latestAnswer) {
            void prepareSpeech(latestAnswer, getSelectedLanguage());
        }
    } catch (error) {
        if (!answerBox.textContent || answerBox.classList.contains("result-placeholder")) {
            answerBox.textContent = "We couldn’t get an answer just now. Please try again.";
        }
        setStatus(controller.signal.aborted
            ? "The answer is taking too long. Please try again in a moment."
            : error.message);
        answerBadge.innerHTML = '<span class="online-dot"></span> Ready when you are';
        console.error("AI response error:", error);
    } finally {
        clearTimeout(timeoutId);
        setBusy(false);
    }
}

askButton.addEventListener("click", () => askQuestion());
questionInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        askQuestion();
    }
});

async function requestSpeechAudio(text, language) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
        response = await fetch("/api/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language }),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        let errorMessage = "Voice playback is unavailable.";
        try {
            const result = await response.json();
            errorMessage = result.error || errorMessage;
        } catch {
            // Keep the readable-answer experience if speech cannot be generated.
        }
        throw new Error(errorMessage);
    }

    const audioBlob = await response.blob();
    if (!audioBlob.size || !audioBlob.type.startsWith("audio/")) {
        throw new Error("The voice service returned an invalid audio file.");
    }

    return audioBlob;
}

function showSpeechAudio(audioBlob) {
    clearAudio();
    const audioUrl = URL.createObjectURL(audioBlob);
    audioPlayer.dataset.objectUrl = audioUrl;
    audioPlayer.src = audioUrl;
    audioPlayer.hidden = false;
    audioPlayer.load();
}

function speakInBrowser(text, language) {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) {
        throw new Error("Audio is unavailable in this browser. You can still read the written answer.");
    }

    const languageCodes = { en: "en-IN", kn: "kn-IN", hinglish: "hi-IN" };
    synth.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = languageCodes[language] || "en-IN";
    utterance.rate = 0.92;
    utterance.onend = () => {
        listenButton.disabled = false;
        listenButton.innerHTML = '<span aria-hidden="true">♫</span> Listen again';
    };
    utterance.onerror = () => {
        listenButton.disabled = false;
        listenButton.innerHTML = '<span aria-hidden="true">♫</span> Try audio again';
        setStatus("The browser could not play this language. Please try the audio player or read the answer.");
    };
    synth.speak(utterance);
}

async function prepareSpeech(text, language) {
    const requestId = ++speechRequestId;
    listenButton.disabled = true;
    listenButton.innerHTML = '<span aria-hidden="true">♫</span> Preparing voice...';

    try {
        const audioBlob = await requestSpeechAudio(text, language);
        if (requestId !== speechRequestId) {
            return;
        }
        showSpeechAudio(audioBlob);
        listenButton.disabled = false;
        listenButton.innerHTML = '<span aria-hidden="true">♫</span> Listen';
        setStatus("");
    } catch (error) {
        if (requestId !== speechRequestId) {
            return;
        }
        audioPlayer.hidden = true;
        listenButton.disabled = !window.speechSynthesis;
        listenButton.innerHTML = '<span aria-hidden="true">♫</span> Listen';
        setStatus("Written answer is ready. Tap Listen for voice playback.", "success");
        console.warn("Audio generation unavailable; browser speech playback will be used:", error);
    }
}

listenButton.addEventListener("click", async () => {
    if (!latestAnswer || listenButton.disabled) {
        return;
    }

    if (audioPlayer.src && !audioPlayer.hidden) {
        try {
            await audioPlayer.play();
            listenButton.disabled = true;
            listenButton.innerHTML = '<span aria-hidden="true">♫</span> Playing...';
        } catch (error) {
            setStatus("Audio could not be played. Try Listen again or use the audio player controls.");
            listenButton.disabled = false;
            console.error("Audio playback error:", error);
        }
        return;
    }

    listenButton.disabled = true;
    try {
        speakInBrowser(latestAnswer, getSelectedLanguage());
    } catch (error) {
        setStatus(error.message);
        listenButton.disabled = false;
    }
});

audioPlayer.addEventListener("ended", () => {
    listenButton.disabled = false;
    listenButton.innerHTML = '<span aria-hidden="true">♫</span> Listen again';
});

audioPlayer.addEventListener("pause", () => {
    if (audioPlayer.currentTime < audioPlayer.duration) {
        listenButton.disabled = false;
        listenButton.innerHTML = '<span aria-hidden="true">♫</span> Listen';
    }
});

function clearImage() {
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = undefined;
    }
    cropImage.value = "";
    imagePreview.removeAttribute("src");
    previewWrap.hidden = true;
    document.getElementById("uploadTitle").textContent = "Add a crop photo";
    document.getElementById("uploadHint").textContent = "JPG, PNG or WebP · Max 10 MB";
    chooseImageButton.textContent = "Choose photo";
    cropImage.value = "";
    setStatus("");
}

imagePreview.addEventListener("error", () => {
    if (imagePreview.src) {
        clearImage();
        setStatus("This photo could not be previewed. Choose a valid JPG, PNG or WebP image.");
    }
});

cropImage.addEventListener("change", () => {
    const file = cropImage.files[0];
    setStatus("");

    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = undefined;
    }
    previewWrap.hidden = true;
    imagePreview.removeAttribute("src");
    document.getElementById("uploadTitle").textContent = "Add a crop photo";
    document.getElementById("uploadHint").textContent = "JPG, PNG or WebP · Max 10 MB";
    chooseImageButton.textContent = "Choose photo";

    if (!file) {
        return;
    }

    const extension = file.name.split(".").pop().toLowerCase();
    const supportedExtensions = ["jpg", "jpeg", "png", "webp"];
    if (!supportedExtensions.includes(extension) ||
        (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
        setStatus("Choose a JPG, PNG or WebP crop photo.");
        cropImage.value = "";
        return;
    }
    if (file.size === 0) {
        setStatus("That image is empty. Choose another photo.");
        cropImage.value = "";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        setStatus("That photo is over 10 MB. Choose a smaller image.");
        cropImage.value = "";
        return;
    }

    previewUrl = URL.createObjectURL(file);
    imagePreview.src = previewUrl;
    imageName.textContent = file.name;
    previewWrap.hidden = false;
    document.getElementById("uploadTitle").textContent = "Photo selected";
    document.getElementById("uploadHint").textContent = "Choose another photo to replace this one";
    chooseImageButton.textContent = "Change photo";
});

document.getElementById("removeImageButton").addEventListener("click", clearImage);

analyzeImageButton.addEventListener("click", async () => {
    if (activeRequest) {
        return;
    }
    const file = cropImage.files[0];
    if (!file) {
        setStatus("Please choose a crop photo first.");
        cropImage.focus();
        return;
    }

    setStatus("");
    const formData = new FormData();
    formData.append("image", file);
    formData.append("language", getSelectedLanguage());
    const details = getFarmDetails();
    formData.append("crop", details.crop);
    formData.append("location", details.location);

    setBusy(true, "Looking at your photo...");
    clearAudio();
    speechRequestId += 1;
    latestAnswer = "";
    listenButton.disabled = true;
    answerBox.textContent = "Looking closely at your crop photo...";
    answerBox.classList.add("result-placeholder");
    transcriptBox.textContent = `Photo: ${file.name}${details.crop ? ` · ${details.crop}` : ""}${details.location ? ` · ${details.location}` : ""}`;
    transcriptBox.classList.remove("result-placeholder");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch("/api/analyze-image/stream", {
            method: "POST",
            body: formData,
            signal: controller.signal
        });
        latestAnswer = await consumeTextStream(response, (_text, answer) => {
            answerBox.textContent = answer;
            answerBox.classList.remove("result-placeholder");
        });
        listenButton.disabled = !latestAnswer;
        answerBadge.innerHTML = '<span class="online-dot"></span> Analysis ready';
        if (latestAnswer) {
            void prepareSpeech(latestAnswer, getSelectedLanguage());
        }
    } catch (error) {
        if (!answerBox.textContent || answerBox.classList.contains("result-placeholder")) {
            answerBox.textContent = "We couldn’t analyze this photo. Check the image and try again.";
        }
        setStatus(controller.signal.aborted
            ? "Photo analysis is taking too long. Please try again in a moment."
            : error.message);
        answerBadge.innerHTML = '<span class="online-dot"></span> Ready when you are';
        console.error("Image analysis error:", error);
    } finally {
        clearTimeout(timeoutId);
        setBusy(false);
    }
});

micButton.addEventListener("click", async () => {
    if (isRequestingMicrophone) {
        return;
    }
    if (activeRequest && !isRecording && !isBrowserRecognizing) {
        return;
    }
    if (isBrowserRecognizing) {
        micStatus.textContent = "Finishing your question...";
        speechRecognition.stop();
        return;
    }
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        micButton.classList.remove("is-recording");
        micButton.disabled = true;
        micButton.setAttribute("aria-label", "Start voice recording");
        micTitle.textContent = "Processing recording...";
        return;
    }

    const canRecordAudio = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!canRecordAudio && SpeechRecognition) {
        speechRecognition = new SpeechRecognition();
        speechRecognition.lang = { en: "en-IN", kn: "kn-IN", hinglish: "hi-IN" }[getSelectedLanguage()];
        speechRecognition.continuous = false;
        speechRecognition.interimResults = false;
        speechRecognition.onresult = (event) => {
            const transcript = event.results?.[0]?.[0]?.transcript?.trim();
            if (!transcript) {
                setStatus("We didn’t hear a question. Please try again or type it below.");
                return;
            }
            questionInput.value = transcript;
            micStatus.textContent = "Question heard. Preparing your answer...";
            void askQuestion(transcript).finally(() => {
                micTitle.textContent = "Ask with your voice";
                micStatus.textContent = "Your voice question has been answered.";
            });
        };
        speechRecognition.onerror = (event) => {
            const messages = {
                "not-allowed": "Allow microphone access in your browser settings, then try again.",
                "service-not-allowed": "Voice recognition is unavailable. Try typing your question instead.",
                "no-speech": "We didn’t hear a question. Please try speaking again.",
                "audio-capture": "No microphone was found. Check your microphone or type your question."
            };
            setStatus(messages[event.error] || "Voice recognition failed. Please try again or type your question.");
            micStatus.textContent = "Voice input stopped.";
        };
        speechRecognition.onend = () => {
            isBrowserRecognizing = false;
            micButton.classList.remove("is-recording");
            micButton.disabled = activeRequest;
            micButton.setAttribute("aria-label", "Start voice recording");
            if (!activeRequest) {
                micTitle.textContent = "Ask with your voice";
                if (micStatus.textContent.includes("Speak now") ||
                    micStatus.textContent.includes("Finishing")) {
                    micStatus.textContent = "Tap the microphone when you have another question.";
                }
            }
        };

        try {
            speechRecognition.start();
            isBrowserRecognizing = true;
            setStatus("");
            micButton.setAttribute("aria-label", "Stop voice recording");
            micTitle.textContent = "Listening...";
            micStatus.textContent = "Speak now. Tap the microphone when you’re done.";
            micButton.classList.add("is-recording");
        } catch (error) {
            isBrowserRecognizing = false;
            setStatus("Could not start voice recognition. Check microphone permissions or type your question.");
            console.error("Speech recognition error:", error);
        }
        return;
    }

    if (!canRecordAudio) {
        micStatus.textContent = "Voice recording isn’t supported in this browser.";
        setStatus("Use Chrome or Edge on localhost/HTTPS and allow microphone access, or type your question instead.");
        return;
    }

    let stream;
    try {
        isRequestingMicrophone = true;
        micButton.disabled = true;
        micButton.setAttribute("aria-label", "Waiting for microphone permission");
        micTitle.textContent = "Connecting microphone...";
        micStatus.textContent = "Allow microphone access in your browser prompt.";
        micButton.classList.add("is-recording");
        if (navigator.permissions?.query) {
            try {
                const permission = await navigator.permissions.query({ name: "microphone" });
                if (permission.state === "denied") {
                    throw new DOMException("Microphone permission is blocked.", "NotAllowedError");
                }
            } catch (error) {
                if (error.name === "NotAllowedError") {
                    throw error;
                }
            }
        }
        const microphoneRequest = navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        let permissionTimeoutId;
        try {
            stream = await Promise.race([
                microphoneRequest,
                new Promise((_, reject) => {
                    permissionTimeoutId = setTimeout(
                        () => reject(new DOMException("Microphone permission request timed out.", "TimeoutError")),
                        15000
                    );
                })
            ]);
        } catch (error) {
            microphoneRequest.then(
                (lateStream) => lateStream.getTracks().forEach((track) => track.stop()),
                () => {}
            );
            throw error;
        } finally {
            clearTimeout(permissionTimeoutId);
        }
        isRequestingMicrophone = false;
        micButton.disabled = false;
        audioChunks = [];
        const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
        const mimeType = typeof MediaRecorder.isTypeSupported === "function"
            ? preferredTypes.find((type) => MediaRecorder.isTypeSupported(type))
            : undefined;
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorder = recorder;
        recorder.onerror = (event) => {
            setStatus(event.error?.message || "Microphone recording failed. Try again or type your question.");
            micStatus.textContent = "Recording stopped.";
        };
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        recorder.onstop = async () => {
            try {
                const audioBlob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
                if (Date.now() - recordingStartedAt < 500 || !audioBlob.size) {
                    setStatus("Please record a little longer, then tap the microphone to finish.");
                    micStatus.textContent = "Recording was too short.";
                    return;
                }
                const extension = audioBlob.type.includes("mp4") ? "mp4" : "webm";
                const formData = new FormData();
                formData.append("audio", audioBlob, `recording.${extension}`);
                formData.append("language", getSelectedLanguage());
                micStatus.textContent = "Transcribing your question...";
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000);
                let response;
                try {
                    response = await fetch("/api/transcribe", {
                        method: "POST",
                        body: formData,
                        signal: controller.signal
                    });
                } finally {
                    clearTimeout(timeoutId);
                }
                const result = await readResponse(response);
                const transcript = (result.transcript || "").trim();
                if (!transcript) {
                    micStatus.textContent = "No speech detected. Please try again.";
                    setStatus("We didn’t hear a question. Please try recording again.");
                    return;
                }
                questionInput.value = transcript;
                transcriptBox.textContent = transcript;
                transcriptBox.classList.remove("result-placeholder");
                micStatus.textContent = "Question transcribed.";
                await askQuestion(transcript);
            } catch (error) {
                micStatus.textContent = "Couldn’t transcribe that recording.";
                setStatus(error.name === "AbortError"
                    ? "Voice transcription is taking too long. Check your connection and try again."
                    : error.message);
                console.error("Transcription error:", error);
            } finally {
                stream.getTracks().forEach((track) => track.stop());
                micButton.disabled = activeRequest;
                micButton.classList.remove("is-recording");
                micButton.setAttribute("aria-label", "Start voice recording");
                micTitle.textContent = "Ask with your voice";
                isRecording = false;
            }
        };

        recorder.start();
        recordingStartedAt = Date.now();
        isRecording = true;
        setStatus("");
        micButton.setAttribute("aria-label", "Stop voice recording");
        micTitle.textContent = "Listening...";
        micStatus.textContent = "Speak now. Tap the microphone to stop.";
        micButton.classList.add("is-recording");
    } catch (error) {
        isRequestingMicrophone = false;
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
        }
        micButton.disabled = false;
        micButton.setAttribute("aria-label", "Start voice recording");
        isRecording = false;
        micButton.classList.remove("is-recording");
        micStatus.textContent = "Microphone could not be started.";
        const messages = {
            NotAllowedError: "Microphone access is blocked. Open the site controls beside the address bar, set Microphone to Allow, then tap the mic again.",
            NotFoundError: "No microphone was found. Check your device or type your question.",
            NotReadableError: "The microphone is busy in another app. Close it and try again.",
            SecurityError: "Microphone access requires localhost or HTTPS. Open this app at http://localhost:5000 and allow microphone access.",
            AbortError: "The microphone could not start. Check that it is connected and not being used by another app.",
            TimeoutError: "The microphone permission prompt did not respond. Allow microphone access in site settings, then try again."
        };
        setStatus(messages[error.name] || "Check microphone permissions and use Chrome or Edge on localhost/HTTPS.");
        micTitle.textContent = "Ask with your voice";
        micStatus.textContent = error.name === "NotAllowedError"
            ? "Microphone is blocked for this site. Allow it in site settings, then tap here again."
            : "Microphone could not be started. Check the message above and try again.";
        console.error("Microphone error:", error);
    }
});
