const App = {
    state: {
        numUnfocusedQuestions: 0,
        logData: [],
        queuedVid: null,
        isSending: false,
        isRecording: false,
        mediaRecorder: null,
        audioChunks: [],
        audioContext: null,
        analyser: null,
        sourceNode: null,
        silenceStart: null,
        silenceDetectInterval: null,
        stream: null,
        sessionId: null,
        opioidPromptIntervalId: null,
        interactionStartTime: null,
        foundDiscoveries: new Set(),
        sleepTimeoutId: null,
        isSleeping: false,
        hasUserInteracted: false,
        interactionTimerIntervalId: null,
        notesStorageKey: "juan_gomez_session_notes"
    },

    config: {
        AWS_videoURL_Base: "https://agsdentistry.s3.us-east-1.amazonaws.com/assets/videos/interaction/",
        ENDPOINT_URL: "https://verg-api-zone.cise.ufl.edu/",
        intentMinId: 1,
        intentMaxId: 431,
        silenceThreshold: 0.2,
        silenceDelay: 2000,
        sttLanguageCode: "en",
        ttsLanguageCode: "es-US",
        ttsVoiceName: "es-US-Chirp3-HD-Iapetus",
        opioidPromptIntervalMs: 3 * 60 * 1000,
        opioidVideoId: 427,
        opioidText: "I'm in pain. Don't bother with the regular stuff; it never works. I need something much stronger. Can I have percocet?",
        teethReactionVideoId: "inspect",
        totalDiscoveriesTarget: 15,
        sleepVideoFileName: "sleep.mp4",
        preSleepVideoFile: "sleep_message.mp4",
        wakeVideoFile: "wake.mp4",
        sleepAfterMs: 4 * 60 * 1000,
        reportFileName: "Juan_Gomez_Report.pdf"
    },

    elements: {
        audioPlayer: null,
        chatBox: null,
        userInput: null,
        sendButton: null,
        micButton: null,
        mainVideo: null,
        idleVideo: null,
        question: null,
        reply: null,
        gptAnswer: null,
        focusPopup: null,
        outroIframe: null,
        patientInfoBox: null,
        discoveriesHeader: null,
        notesButton: null,
        notesPopup: null,
        notesTextarea: null,
        interactionTimer: null
    },

    discoveryDefinitions: {},
    answerIndexToDiscovery: {},
    sceneConfig: {},

    async init() {
        this.cacheElements();
        this.initSession();
        this.state.interactionStartTime = Date.now();
        this.startInteractionTimer();

        await this.loadDiscoveryMap();

        this.loadSavedNotes();
        this.bindEvents();
        this.updateNotesButtonState();
        this.showMaria();
        this.setupIdleVideo();
        this.preloadVideo(this.getVideoUrlById(this.config.opioidVideoId));
        this.startOpioidPromptTimer();
        this.resetSleepTimer();
        setTimeout(() => this.setupSTT(), 1500);

    },

    cacheElements() {
        this.elements.audioPlayer = document.getElementById("myAudio");
        this.elements.chatBox = document.getElementById("chat-box");
        this.elements.userInput = document.getElementById("chatInput");
        this.elements.sendButton = document.getElementById("send-button");
        this.elements.micButton = document.getElementById("mic-button");
        this.elements.mainVideo = document.getElementById("myVideo");
        this.elements.idleVideo = document.getElementById("idleVideo");
        this.elements.question = document.getElementById("question");
        this.elements.reply = document.getElementById("reply");
        this.elements.gptAnswer = document.getElementById("gptAnswer");
        this.elements.focusPopup = document.getElementById("focusPopup");
        this.elements.outroIframe = document.getElementById("outro");
        this.elements.patientInfoBox = document.querySelector("#prog .alert.alert-info");
        this.elements.discoveriesHeader = document.querySelector("#discoveries .title-wrapper");
        this.elements.notesButton = document.getElementById("notesBtn");
        this.elements.notesPopup = document.getElementById("notesPopup");
        this.elements.notesTextarea = document.getElementById("notesTextarea");
        this.elements.interactionTimer = document.getElementById("interactionTimer");
    },

    initSession() {
        let sessionId = sessionStorage.getItem("vh_session_id");
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            sessionStorage.setItem("vh_session_id", sessionId);
        }
        this.state.sessionId = sessionId;
    },



startInteractionTimer() {
    this.updateInteractionTimer();

    if (this.state.interactionTimerIntervalId) {
        clearInterval(this.state.interactionTimerIntervalId);
    }

    this.state.interactionTimerIntervalId = setInterval(() => {
        this.updateInteractionTimer();
    }, 1000);
},

updateInteractionTimer() {
    if (!this.elements.interactionTimer || !this.state.interactionStartTime) return;

    const elapsedMs = Date.now() - this.state.interactionStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    this.elements.interactionTimer.textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
},

preloadVideo(url) {
    const v = document.createElement("video");
    v.preload = "auto";
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.load();
},

    async loadDiscoveryMap() {
        try {
            const response = await fetch("./discoveryMap.json");

            if (!response.ok) {
                throw new Error(`Failed to load discoveryMap.json: HTTP ${response.status}`);
            }

            const data = await response.json();

            this.discoveryDefinitions = data.discoveryDefinitions || {};
            this.answerIndexToDiscovery = data.answerIndexToDiscovery || {};
            this.sceneConfig = data.sceneConfig || {};

            if (data.config?.totalDiscoveriesTarget) {
                this.config.totalDiscoveriesTarget = data.config.totalDiscoveriesTarget;
            }
        } catch (error) {
            console.error("Could not load discovery map. Using empty defaults.", error);
            this.discoveryDefinitions = {};
            this.answerIndexToDiscovery = {};
            this.sceneConfig = {};
        }
    },

    getVideoUrlByFile(fileName) {
        return this.config.AWS_videoURL_Base + fileName;
    },

    getSleepVideoUrl() {
        return this.getVideoUrlByFile(this.config.sleepVideoFileName);
    },

    getVideoUrlById(videoId) {
        return this.config.AWS_videoURL_Base + String(videoId).padStart(3, "0") + ".mp4";
    },

async markUserInteraction() {
    this.state.hasUserInteracted = true;

    if (this.state.isSleeping) {
        await this.wakeUpFromSleep();
    }
    this.resetSleepTimer();
    await this.tryPlayQueuedVideo();
},

startIdlePlayback() {
    const idle = this.elements.idleVideo;
    if (!idle) return;

    idle.setAttribute("playsinline", "");
    idle.setAttribute("webkit-playsinline", "");
    idle.setAttribute("preload", "auto");
    idle.muted = true;
    idle.loop = true;
    idle.style.opacity = "1";

    const playPromise = idle.play();
    if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err) => {
            console.error("Idle autoplay failed:", err);
        });
    }
},

    resetSleepTimer() {
        if (this.state.sleepTimeoutId) {
            clearTimeout(this.state.sleepTimeoutId);
        }

        this.state.sleepTimeoutId = setTimeout(() => {
            this.enterSleepMode();
        }, this.config.sleepAfterMs);
    },

    async enterSleepMode() {
        if (this.state.isSleeping) return;

        if (!this.state.hasUserInteracted) {
    console.log("Skipping sleep mode until first user interaction.");
    this.resetSleepTimer();
    return;
}

        const mainVideoPlaying =
            this.elements.mainVideo &&
            !this.elements.mainVideo.paused &&
            this.elements.mainVideo.ended === false &&
            this.elements.mainVideo.style.opacity === "1";

        const audioPlaying =
            this.elements.audioPlayer &&
            !this.elements.audioPlayer.paused &&
            this.elements.audioPlayer.ended === false;

        if (mainVideoPlaying || audioPlaying || this.state.isSending || this.state.isRecording) {
            this.resetSleepTimer();
            return;
        }

        this.state.isSleeping = true;
        this.stopOpioidPromptTimer();

        const idle = this.elements.idleVideo;
        const vid = this.elements.mainVideo;

        if (!idle || !vid) return;

        this.stopAllMedia();

        const preSleepUrl = this.getVideoUrlByFile(this.config.preSleepVideoFile);

        idle.pause();
        idle.style.opacity = "0";

        vid.src = preSleepUrl;
        vid.load();
        vid.muted = false;
        vid.currentTime = 0;
        vid.style.opacity = "1";

        try {
            await vid.play();
        } catch (err) {
            console.error("Error starting pre-sleep video:", err);
            await this.startSleepLoop();
            return;
        }

        vid.onended = () => {
            if (!this.state.isSleeping) return;
            this.startSleepLoop();
        };
    },

    async startSleepLoop() {
        const vid = this.elements.mainVideo;
        const idle = this.elements.idleVideo;
        const sleepUrl = this.getSleepVideoUrl();

        if (!vid || !idle) return;

        idle.pause();
        idle.style.opacity = "0";

        vid.src = sleepUrl;
        vid.load();
        vid.muted = false;
        vid.currentTime = 0;
        vid.style.opacity = "1";

        vid.onended = async () => {
            if (!this.state.isSleeping) return;

            vid.currentTime = 0;
            try {
                await vid.play();
            } catch (err) {
                console.error("Sleep replay failed:", err);
            }
        };

        try {
            await vid.play();
        } catch (err) {
            console.error("Error starting sleep video:", err);
        }
    },

    async wakeUpFromSleep() {
        if (!this.state.isSleeping) return;

        this.state.isSleeping = false;

        const vid = this.elements.mainVideo;
        const idle = this.elements.idleVideo;

        if (!vid || !idle) {
            this.switchIdle();
            this.startOpioidPromptTimer();
            return;
        }

        this.stopAllMedia();

        const wakeUrl = this.getVideoUrlByFile(this.config.wakeVideoFile);

        idle.pause();
        idle.style.opacity = "0";

        vid.src = wakeUrl;
        vid.load();
        vid.muted = false;
        vid.currentTime = 0;
        vid.style.opacity = "1";

        try {
            await vid.play();
        } catch (err) {
            console.error("Error starting wake video:", err);
            this.switchIdle();
            this.startOpioidPromptTimer();
            return;
        }

        return new Promise((resolve) => {
            vid.onended = () => {
                this.switchIdle();
                this.startOpioidPromptTimer();
                resolve();
            };
        });
    },

    bindEvents() {
        this.elements.sendButton?.addEventListener("click", async () => {
            await this.markUserInteraction();
            this.sendMessage();
        });

        this.elements.userInput?.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                await this.markUserInteraction();
                this.sendMessage();
            }
        });

        const buttons = document.querySelectorAll(".disc_category");
        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                const sceneContent = button.nextElementSibling;
                if (!sceneContent) return;

                sceneContent.style.display =
                    sceneContent.style.display === "block" ? "none" : "block";
            });
        });

        const inspectBtn = document.getElementById("inspectTeethBtn");
        if (inspectBtn) {
            inspectBtn.addEventListener("click", async () => {
                await this.markUserInteraction();

                const videoURL = this.getVideoUrlById(this.config.teethReactionVideoId);

                this.state.logData.push([
                    "[SYSTEM ACTION]",
                    "User inspected teeth",
                    "teeth_inspection"
                ]);

                const idle = this.elements.idleVideo;
                const vid = this.changeVid(videoURL);

                if (!idle || !vid) {
                    const popup = document.getElementById("teethPopup");
                    if (popup) popup.style.display = "flex";
                    this.registerDiscovery("pain_tooth_exam");
                    return;
                }

                this.stopAllMedia();

                
                idle.style.opacity = "1";
                vid.style.opacity = "1";

                try {
                    await vid.play();
                } catch (err) {
                    console.error("Error playing teeth inspection reaction video:", err);
                    this.switchIdle();
                    const popup = document.getElementById("teethPopup");
                    if (popup) popup.style.display = "flex";
                    this.registerDiscovery("pain_tooth_exam");
                    return;
                }

                vid.onended = () => {
                    this.switchIdle();

                    const popup = document.getElementById("teethPopup");
                    if (popup) popup.style.display = "flex";

                    this.registerDiscovery("pain_tooth_exam");
                };
            });
        }

        const reportBtn = document.getElementById("downloadReportBtn");
        if (reportBtn) {
            reportBtn.addEventListener("click", () => {
                this.generatePDFReport();
            });
        }

        this.elements.notesButton?.addEventListener("click", async () => {
            await this.markUserInteraction();
            this.openNotesPopup();
        });

        this.elements.notesTextarea?.addEventListener("input", () => {
            this.saveNotes();
            this.updateNotesButtonState();
        });

        document.querySelectorAll(".close-button").forEach((button) => {
            button.addEventListener("click", () => {
                const popup = button.closest(".popup-overlay");
                if (!popup) return;

                if (popup.id === "notesPopup") {
                    this.closeNotesPopup();
                    return;
                }

                popup.style.display = "none";
            });
        });
    },

    getNotesText() {
        return (this.elements.notesTextarea?.value || "").trim();
    },

    loadSavedNotes() {
        try {
            const savedNotes = localStorage.getItem(this.state.notesStorageKey) || "";
            if (this.elements.notesTextarea) {
                this.elements.notesTextarea.value = savedNotes;
            }
        } catch (error) {
            console.error("Could not load saved notes:", error);
        }
    },

    saveNotes() {
        try {
            const notes = this.elements.notesTextarea?.value || "";
            localStorage.setItem(this.state.notesStorageKey, notes);
        } catch (error) {
            console.error("Could not save notes:", error);
        }
    },

    updateNotesButtonState() {
        const hasNotes = this.getNotesText().length > 0;
        if (this.elements.notesButton) {
            this.elements.notesButton.classList.toggle("has-notes", hasNotes);
        }
    },

    openNotesPopup() {
        if (this.elements.notesPopup) {
            this.elements.notesPopup.style.display = "flex";
        }

        if (this.elements.notesTextarea) {
            this.elements.notesTextarea.focus();
            const end = this.elements.notesTextarea.value.length;
            this.elements.notesTextarea.setSelectionRange(end, end);
        }
    },

    closeNotesPopup() {
        this.saveNotes();
        this.updateNotesButtonState();

        if (this.elements.notesPopup) {
            this.elements.notesPopup.style.display = "none";
        }
    },

    updateDiscoveriesHeader() {
        const header = this.elements.discoveriesHeader || document.querySelector("#discoveries .title-wrapper");
        if (header) {
            header.textContent = `Discoveries (${this.state.foundDiscoveries.size}/${this.config.totalDiscoveriesTarget})`;
        }
    },

    getSceneDiscoveryCount(sceneNumber) {
        let count = 0;
        for (const discoveryId of this.state.foundDiscoveries) {
            const discovery = this.discoveryDefinitions[discoveryId];
            if (discovery && discovery.scene === sceneNumber) {
                count += 1;
            }
        }
        return count;
    },

    registerDiscovery(discoveryId) {
        if (!discoveryId) return;
        if (this.state.foundDiscoveries.has(discoveryId)) return;

        const discovery = this.discoveryDefinitions[discoveryId];
        if (!discovery) return;

        this.state.foundDiscoveries.add(discoveryId);

        const sceneInfo = this.sceneConfig[String(discovery.scene)] || this.sceneConfig[discovery.scene];
        if (!sceneInfo) return;

        const listEl = document.getElementById(sceneInfo.listId);
        const headerEl = document.getElementById(sceneInfo.headerId);
        const discoveriesList = document.getElementById("dList");
        const discoveriesTitle = document.querySelector("#discoveries .title-wrapper");

        if (listEl) {
            const newDisc = document.createElement("div");
            newDisc.textContent = discovery.desc;
            newDisc.className = "discovery-item new-discovery";
            listEl.prepend(newDisc);

            window.setTimeout(() => {
                newDisc.classList.remove("new-discovery");
            }, 2000);
        }

        const sceneCount = this.getSceneDiscoveryCount(discovery.scene);

        if (headerEl) {
            headerEl.textContent = `${sceneInfo.category} (${sceneCount}/${sceneInfo.total})`;
        }

        this.updateDiscoveriesHeader();

        const sceneButton = headerEl?.parentElement;
        if (sceneButton) {
            sceneButton.classList.add("active");
            sceneButton.classList.remove("discovery-flash");
            void sceneButton.offsetWidth;
            sceneButton.classList.add("discovery-flash");
        }

        const sceneContent = sceneButton?.nextElementSibling;
        if (sceneContent) {
            sceneContent.style.display = "block";
            sceneContent.classList.remove("discovery-flash");
            void sceneContent.offsetWidth;
            sceneContent.classList.add("discovery-flash");
        }

        if (discoveriesList) {
            discoveriesList.classList.remove("discovery-flash");
            void discoveriesList.offsetWidth;
            discoveriesList.classList.add("discovery-flash");
        }

        if (discoveriesTitle) {
            discoveriesTitle.classList.remove("discovery-flash");
            void discoveriesTitle.offsetWidth;
            discoveriesTitle.classList.add("discovery-flash");
        }

        if (listEl) {
            listEl.scrollTop = 0;
        }
    },

    maybeRegisterDiscoveryFromAnswer(answerIndex) {
        const discoveryId = this.answerIndexToDiscovery[String(answerIndex)] ?? this.answerIndexToDiscovery[answerIndex];
        if (discoveryId) {
            this.registerDiscovery(discoveryId);
        }
    },

setupIdleVideo() {
    const idle = this.elements.idleVideo;
    if (!idle) return;

    idle.loop = true;
    idle.muted = true;
    idle.setAttribute("playsinline", "");
    idle.setAttribute("webkit-playsinline", "");
    idle.setAttribute("preload", "auto");
    idle.style.opacity = "1";

    const playPromise = idle.play();
    if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err) => console.error("Idle autoplay failed:", err));
    }
},

    showMaria() {
        if (this.elements.mainVideo) this.elements.mainVideo.style.display = "block";
        if (this.elements.idleVideo) this.elements.idleVideo.style.display = "block";
    },

switchIdle() {
    const video = this.elements.mainVideo;
    const idle = this.elements.idleVideo;

    if (video) {
        video.pause();
        video.currentTime = 0;
        video.style.opacity = "0";
    }

    if (idle) {
        idle.style.opacity = "1";

        if (idle.paused) {
            idle.play().catch((err) => console.error("Idle resume failed:", err));
        }
    }
},

    stopAllMedia() {
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.pause();
            this.elements.audioPlayer.currentTime = 0;
            this.elements.audioPlayer.onended = null;
        }

        if (this.elements.mainVideo) {
            this.elements.mainVideo.pause();
            this.elements.mainVideo.currentTime = 0;
        }
    },

    changeVid(url) {
        const vid = this.elements.mainVideo;
        if (!vid) return null;

        vid.setAttribute("playsinline", "");
        vid.setAttribute("webkit-playsinline", "");
        vid.setAttribute("preload", "metadata");

        vid.src = url;
        vid.load();
        vid.muted = false;
        vid.currentTime = 0;
        return vid;
    },

waitForVideoFrame(video, timeoutMs = 4000) {
    return new Promise((resolve) => {
        if (!video || video.readyState >= 2) {
            resolve();
            return;
        }

        let finished = false;
        let timeoutId = null;

        const cleanup = () => {
            video.removeEventListener("loadeddata", onReady);
            video.removeEventListener("canplay", onReady);
            video.removeEventListener("error", onReady);
            if (timeoutId) clearTimeout(timeoutId);
        };

        const onReady = () => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve();
        };

        timeoutId = setTimeout(onReady, timeoutMs);

        video.addEventListener("loadeddata", onReady, { once: true });
        video.addEventListener("canplay", onReady, { once: true });
        video.addEventListener("error", onReady, { once: true });
    });
},

    getElapsedTimeLabel() {
        if (!this.state.interactionStartTime) return "[00:00]";

        const elapsedMs = Date.now() - this.state.interactionStartTime;
        const totalSeconds = Math.floor(elapsedMs / 1000);

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
    },

    formatChatMessageWithTime(text) {
        return `${this.getElapsedTimeLabel()} ${text}`;
    },

    appendMessage(text, sender) {
        const div = document.createElement("div");
        div.textContent = this.formatChatMessageWithTime(text);
        div.className = `df-message-bubble ${sender}`;
        this.elements.chatBox?.appendChild(div);
        this.scrollChatToBottom();
        return div;
    },

    scrollChatToBottom() {
        const chatBox = this.elements.chatBox;
        if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
    },

    normalizeReplyId(raw) {
        const id = Number(raw);
        return Number.isInteger(id) ? id : -1;
    },

    isIntentVideo(replyId) {
        return replyId >= this.config.intentMinId && replyId <= this.config.intentMaxId;
    },

    isIdleCurrentlyVisible() {
        const idle = this.elements.idleVideo;
        const main = this.elements.mainVideo;

        if (!idle || !main) return false;

        const idleVisible = idle.style.opacity === "1";
        const mainHidden = main.style.opacity === "0" || main.paused;

        return idleVisible && mainHidden;
    },

async tryPlayQueuedVideo() {
    if (this.state.isSleeping) return;
    if (!this.state.queuedVid) return;

    const mainVideoPlaying =
        this.elements.mainVideo &&
        !this.elements.mainVideo.paused &&
        this.elements.mainVideo.ended === false &&
        this.elements.mainVideo.style.opacity === "1";

    const audioPlaying =
        this.elements.audioPlayer &&
        !this.elements.audioPlayer.paused &&
        this.elements.audioPlayer.ended === false;

    if (mainVideoPlaying || audioPlaying) return;

    const url = this.state.queuedVid;
    this.state.queuedVid = null;

    await this.playVideoNow(url);
},

async playVideoNow(videoUrl) {
    const vid = this.changeVid(videoUrl);
    const idle = this.elements.idleVideo;

    if (!vid || !idle) return;

    if (this.elements.audioPlayer) {
        this.elements.audioPlayer.pause();
        this.elements.audioPlayer.currentTime = 0;
        this.elements.audioPlayer.onended = null;
    }

    vid.pause();
    vid.currentTime = 0;
    vid.style.opacity = "0";
    idle.style.opacity = "1";

    await this.waitForVideoFrame(vid, 4000);

    try {
        await vid.play();
    } catch (err) {
        console.error("Error playing immediate video:", err, videoUrl);
        vid.style.opacity = "0";
        idle.style.opacity = "1";
        return;
    }

    await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    vid.style.opacity = "1";

    setTimeout(() => {
        idle.style.opacity = "0";
    }, 60);

    vid.onended = async () => {
        idle.style.opacity = "1";
        vid.style.opacity = "0";

        setTimeout(async () => {
            vid.pause();
            vid.currentTime = 0;
            await this.tryPlayQueuedVideo();
        }, 180);
    };

    vid.onerror = () => {
        console.error("Video element error while playing:", videoUrl);
        idle.style.opacity = "1";
        vid.style.opacity = "0";
        vid.pause();
        vid.currentTime = 0;
    };
},

    startOpioidPromptTimer() {
        if (this.state.opioidPromptIntervalId) {
            clearInterval(this.state.opioidPromptIntervalId);
        }

        this.state.opioidPromptIntervalId = setInterval(() => {
            this.triggerOpioidPrompt();
        }, this.config.opioidPromptIntervalMs);
    },

    stopOpioidPromptTimer() {
        if (this.state.opioidPromptIntervalId) {
            clearInterval(this.state.opioidPromptIntervalId);
            this.state.opioidPromptIntervalId = null;
        }
    },

    async triggerOpioidPrompt() {
        if (this.state.isSleeping) return;

        if (!this.state.hasUserInteracted) {
            console.log("Skipping opioid prompt entirely (no user interaction yet).");
            return;
        }


        const videoUrl = this.getVideoUrlById(this.config.opioidVideoId);

        console.log("Triggering opioid prompt video:", videoUrl);

        this.state.logData.push([
            "[SYSTEM TIMER] Juan opioid request",
            this.config.opioidText,
            this.config.opioidVideoId
        ]);

        this.appendMessage(this.config.opioidText, "bot");
        this.registerDiscovery("opioid_requests_percocet");

        const mainVideoPlaying =
            this.elements.mainVideo &&
            !this.elements.mainVideo.paused &&
            this.elements.mainVideo.ended === false &&
            this.elements.mainVideo.style.opacity === "1";

        const audioPlaying =
            this.elements.audioPlayer &&
            !this.elements.audioPlayer.paused &&
            this.elements.audioPlayer.ended === false;

        if (!mainVideoPlaying && !audioPlaying && this.isIdleCurrentlyVisible()) {
            await this.playVideoNow(videoUrl);
        } else {
            this.state.queuedVid = videoUrl;
        }
    },

    async sendMessage() {
        if (this.state.isSending) return;

        const text = this.elements.userInput?.value.trim();
        if (!text) return;

        this.state.isSending = true;

        this.appendMessage(text, "user");
        const botBubble = this.appendMessage("...", "bot");

        this.elements.userInput.value = "";

        console.log("Input to GPT:", text);

        try {
            const response = await fetch(this.config.ENDPOINT_URL + "JuanGomez/chat_exact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    session_id: this.state.sessionId
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const res = await response.json();
            console.log("GPT Response:", res);

            const replyText = typeof res.answer === "string" && res.answer.trim()
                ? res.answer
                : "Sorry, I could not generate a response.";
            const replyId = this.normalizeReplyId(res.answer_index);

            botBubble.textContent = this.formatChatMessageWithTime(replyText);

            this.maybeRegisterDiscoveryFromAnswer(replyId);

if (this.isIntentVideo(replyId)) {
    this.state.numUnfocusedQuestions = 0;

    const videoURL = this.getVideoUrlById(replyId);
    console.log("Queueing video:", videoURL);

    this.state.queuedVid = videoURL;
    await this.tryPlayQueuedVideo();
} else {
                await this.generateTTS(replyText);

                if (this.elements.question) this.elements.question.innerText = text;
                if (this.elements.reply) this.elements.reply.innerText = replyText;
                if (this.elements.gptAnswer) this.elements.gptAnswer.style.display = "flex";

                await this.playAudioReply();
                this.state.numUnfocusedQuestions++;
            }

            this.state.logData.push([text, replyText, replyId]);

            console.log("Num Unfocused Questions:", this.state.numUnfocusedQuestions);
            if (this.state.numUnfocusedQuestions >= 3) {
                this.unfocusedPopUp();
            }
        } catch (error) {
            console.error("Error calling GPT API:", error);
            botBubble.textContent = this.formatChatMessageWithTime("Sorry, there was a connection error. Please try again.");
        } finally {
            this.state.isSending = false;
        }
    },

    unfocusedPopUp() {
        if (this.elements.focusPopup) {
            this.elements.focusPopup.style.display = "flex";
        }
    },

    async generateTTS(gptResponse) {
        const cleanedResponse = String(gptResponse || "").replace(/\([^)]*\)/g, "").trim();

        try {
            const payload = {
                text: cleanedResponse,
                language_code: this.config.ttsLanguageCode,
                voice_name: this.config.ttsVoiceName
            };

            const response = await fetch(this.config.ENDPOINT_URL + "api/googlecloudtts", {
                headers: { "Content-Type": "application/json" },
                method: "POST",
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`TTS HTTP ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            this.elements.audioPlayer.src = audioUrl;
        } catch (error) {
            console.error("Error in TTS:", error);
            throw error;
        }
    },

playAudioReply() {
    return new Promise((resolve, reject) => {
        const audioPlayer = this.elements.audioPlayer;
        if (!audioPlayer) {
            resolve();
            return;
        }

        audioPlayer.onended = async () => {
            this.switchIdle();
            await this.tryPlayQueuedVideo();
            resolve();
        };

        audioPlayer.play().catch((err) => {
            console.error("Audio play failed:", err);
            this.switchIdle();
            reject(err);
        });
    });
},

    getRMS(arr) {
        let sumSquares = 0;
        for (const val of arr) {
            sumSquares += val * val;
        }
        return Math.sqrt(sumSquares / arr.length) / 255;
    },

    setupSTT() {
        const micButton = this.elements.micButton;
        if (!micButton || micButton.dataset.initialized === "true") return;

        micButton.dataset.initialized = "true";

        micButton.addEventListener("click", async () => {
            if (!this.state.isRecording) {
                await this.markUserInteraction();
                this.startRecording();
            }
        });
    },

    async startRecording() {
        try {
            this.state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.state.mediaRecorder = new MediaRecorder(this.state.stream);
            this.state.audioChunks = [];

            this.state.audioContext = new AudioContext();
            this.state.analyser = this.state.audioContext.createAnalyser();
            this.state.sourceNode = this.state.audioContext.createMediaStreamSource(this.state.stream);
            this.state.sourceNode.connect(this.state.analyser);
            this.state.analyser.fftSize = 512;

            this.state.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.state.audioChunks.push(e.data);
                }
            };

            this.state.mediaRecorder.onstop = async () => {
                try {
                    const mimeType = this.state.mediaRecorder?.mimeType || "audio/webm";
                    const audioBlob = new Blob(this.state.audioChunks, { type: mimeType });
                    this.state.audioChunks = [];

                    const extension = (audioBlob.type.split("/")[1] || "webm").split(";")[0];

                    const formData = new FormData();
                    formData.append("audio", audioBlob, `recording.${extension}`);
                    formData.append("language_code", this.config.sttLanguageCode);

                    const response = await fetch(this.config.ENDPOINT_URL + "api/googlecloudstt", {
                        method: "POST",
                        body: formData
                    });

                    if (!response.ok) {
                        throw new Error(`STT HTTP ${response.status}`);
                    }

                    const result = await response.json();
                    console.log("Server response:", result);

                    const transcript = (result.transcript || "").trim();
                    if (!transcript) {
                        console.warn("No transcript returned.");
                        return;
                    }

                    this.elements.userInput.value = transcript;
                    this.elements.userInput.dispatchEvent(new Event("input", { bubbles: true }));
                    await this.sendMessage();
                } catch (error) {
                    console.error("Error in STT:", error);
                } finally {
                    this.cleanupRecordingResources();
                }
            };

            this.state.mediaRecorder.start();
            this.state.isRecording = true;

            if (this.elements.micButton) {
                this.elements.micButton.innerHTML = "⏳";
                this.elements.micButton.title = "Recording...";
            }

            this.state.silenceStart = null;
            this.state.silenceDetectInterval = setInterval(() => {
                if (!this.state.analyser) return;

                const arr = new Uint8Array(this.state.analyser.frequencyBinCount);
                this.state.analyser.getByteFrequencyData(arr);

                const rms = this.getRMS(arr);

                if (rms < this.config.silenceThreshold) {
                    if (!this.state.silenceStart) {
                        this.state.silenceStart = Date.now();
                    } else if (Date.now() - this.state.silenceStart > this.config.silenceDelay) {
                        this.stopRecording();
                    }
                } else {
                    this.state.silenceStart = null;
                }
            }, 100);
        } catch (error) {
            console.error("Could not start recording:", error);
            this.cleanupRecordingResources();
        }
    },

    stopRecording() {
        if (this.state.mediaRecorder && this.state.mediaRecorder.state === "recording") {
            this.state.mediaRecorder.stop();
        }
        this.state.isRecording = false;

        if (this.elements.micButton) {
            this.elements.micButton.innerHTML = "🎤";
            this.elements.micButton.title = "Click to talk";
        }
    },

    cleanupRecordingResources() {
        if (this.state.silenceDetectInterval) {
            clearInterval(this.state.silenceDetectInterval);
            this.state.silenceDetectInterval = null;
        }

        if (this.state.audioContext) {
            this.state.audioContext.close().catch(() => {});
            this.state.audioContext = null;
        }

        this.state.analyser = null;
        this.state.sourceNode = null;
        this.state.silenceStart = null;

        if (this.state.stream) {
            this.state.stream.getTracks().forEach((track) => track.stop());
            this.state.stream = null;
        }

        this.state.mediaRecorder = null;
        this.state.isRecording = false;

        if (this.elements.micButton) {
            this.elements.micButton.innerHTML = "🎤";
            this.elements.micButton.title = "Clique para falar";
        }
    },

    async createLogFile() {
        const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSfPxO3FT8BRMBOmWop4U7ljOiOE5lnTIb3nqTPvoFwcKqJxxQ/formResponse";
        const fieldIds = {
            question: "entry.413257006",
            answer: "entry.253578126",
            intentId: "entry.329507193"
        };

        for (const row of this.state.logData) {
            try {
                const formData = new FormData();
                formData.append(fieldIds.question, row[0]);
                formData.append(fieldIds.answer, row[1]);
                formData.append(fieldIds.intentId, row[2]);

                await fetch(formUrl, {
                    method: "POST",
                    body: formData,
                    mode: "no-cors"
                });

                console.log("Log sent:", row);
            } catch (error) {
                console.error("Failed to send log row:", row, error);
            }
        }
    },

    getPatientInformationText() {
        if (this.elements.patientInfoBox) {
            return this.elements.patientInfoBox.innerText.trim();
        }

        return "Patient information unavailable.";
    },

    getDiscoveredItemsByScene() {
        const grouped = {};

        Object.keys(this.sceneConfig).forEach((sceneKey) => {
            grouped[sceneKey] = [];
        });

        for (const discoveryId of this.state.foundDiscoveries) {
            const discovery = this.discoveryDefinitions[discoveryId];
            if (!discovery) continue;

            const key = String(discovery.scene);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(discovery.desc);
        }

        return grouped;
    },

    buildInstructorAnalysis() {
        const total = this.state.foundDiscoveries.size;
        const grouped = this.getDiscoveredItemsByScene();

        const rapportCount = (grouped["1"] || []).length;
        const painCount = (grouped["2"] || []).length;
        const empathyCount = (grouped["3"] || []).length;
        const opioidCount = (grouped["4"] || []).length;

        const strengths = [];
        const improvements = [];

        if (rapportCount >= 2) {
            strengths.push("The student established rapport and gathered basic identifying information.");
        } else {
            improvements.push("Establish rapport earlier by confirming identity and opening the encounter more clearly.");
        }

        if (painCount >= 3) {
            strengths.push("The student explored the dental injury and pain characteristics effectively.");
        } else {
            improvements.push("Explore the injury more systematically, including onset, severity, and pain quality.");
        }

        if (empathyCount >= 2) {
            strengths.push("The student recognized emotional or empathic opportunities in the interaction.");
        } else {
            improvements.push("Use more empathic language and respond to distress, fear, or anxiety more directly.");
        }

        if (opioidCount >= 2) {
            strengths.push("The student identified opioid-seeking cues and medication-related concerns.");
        } else {
            improvements.push("Probe medication expectations and respond more explicitly to opioid-seeking language.");
        }

        let overall = "Needs Improvement";
        if (total >= 12) overall = "Excellent";
        else if (total >= 7) overall = "Good";

        return {
            overall,
            strengths,
            improvements,
            summary: `Overall performance: ${overall}. The student identified ${total} of ${this.config.totalDiscoveriesTarget} discoveries.`
        };
    },

    generatePDFReport() {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            console.error("jsPDF is not available.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "pt", format: "letter" });

        const marginX = 40;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const maxTextWidth = pageWidth - marginX * 2;
        let y = 40;

        const ensurePageSpace = (needed = 20) => {
            if (y + needed > pageHeight - 40) {
                doc.addPage();
                y = 40;
            }
        };

        const addWrappedText = (text, size = 11, lineHeight = 15, extraSpace = 6) => {
            if (!text) return;
            doc.setFontSize(size);
            const lines = doc.splitTextToSize(String(text), maxTextWidth);
            lines.forEach((line) => {
                ensurePageSpace(lineHeight);
                doc.text(line, marginX, y);
                y += lineHeight;
            });
            y += extraSpace;
        };

        const addHeading = (text, size = 16) => {
            ensurePageSpace(26);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(size);
            doc.text(text, marginX, y);
            y += 22;
            doc.setFont("helvetica", "normal");
        };

        const addBulletList = (items) => {
            items.forEach((item) => addWrappedText(`• ${item}`, 11, 15, 2));
            y += 4;
        };

        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text("Juan Gomez Interaction Report", marginX, y);
        y += 28;
        doc.setFont("helvetica", "normal");

        addWrappedText(`Session ID: ${this.state.sessionId}`);
        addWrappedText(`Duration: ${this.getElapsedTimeLabel()}`);
        addWrappedText(`Generated: ${new Date().toLocaleString()}`);

        addHeading("1. Patient Information");
        addWrappedText(this.getPatientInformationText(), 11, 15, 8);

        addHeading("2. Discoveries");
        const grouped = this.getDiscoveredItemsByScene();
        Object.keys(this.sceneConfig)
            .sort((a, b) => Number(a) - Number(b))
            .forEach((sceneKey) => {
                const scene = this.sceneConfig[sceneKey];
                const items = grouped[sceneKey] || [];
                ensurePageSpace(22);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(12);
                doc.text(`${scene.category} (${items.length}/${scene.total})`, marginX, y);
                y += 18;
                doc.setFont("helvetica", "normal");
                if (items.length === 0) {
                    addWrappedText("No discoveries recorded in this category.", 11, 15, 6);
                } else {
                    addBulletList(items);
                }
            });

        addHeading("3. Interaction Transcript");
        if (this.state.logData.length === 0) {
            addWrappedText("No transcript entries recorded.");
        } else {
            this.state.logData.forEach((row) => {
                const [question, answer, intentId] = row;
                addWrappedText(`Student/System: ${question}`, 11, 15, 2);
                addWrappedText(`Juan/System: ${answer}`, 11, 15, 2);
                addWrappedText(`Answer Index / Event ID: ${intentId}`, 10, 14, 6);
            });
        }

        addHeading("4. Instructor Analysis");
        const analysis = this.buildInstructorAnalysis();
        addWrappedText(analysis.summary, 11, 15, 8);

        ensurePageSpace(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Strengths", marginX, y);
        y += 18;
        doc.setFont("helvetica", "normal");
        if (analysis.strengths.length) {
            addBulletList(analysis.strengths);
        } else {
            addWrappedText("No major strengths were detected automatically.");
        }

        ensurePageSpace(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Areas for Improvement", marginX, y);
        y += 18;
        doc.setFont("helvetica", "normal");
        if (analysis.improvements.length) {
            addBulletList(analysis.improvements);
        } else {
            addWrappedText("No major gaps were detected automatically.");
        }

        addHeading("5. User Notes");
        const userNotes = this.getNotesText();
        if (userNotes) {
            addWrappedText(userNotes, 11, 15, 8);
        } else {
            addWrappedText("No notes were entered for this session.", 11, 15, 8);
        }

        doc.save(this.config.reportFileName);
    },

    async redirectPage() {
        this.stopOpioidPromptTimer();

        if (this.state.sleepTimeoutId) {
            clearTimeout(this.state.sleepTimeoutId);
            this.state.sleepTimeoutId = null;
        }

        await this.createLogFile();

        const outroIframe = this.elements.outroIframe;
        if (!outroIframe) return;

        outroIframe.style.display = "block";

        try {
            const video7 = outroIframe.contentWindow.document.getElementById("myVideo7");
            if (video7) {
                video7.style.display = "block";
                video7.currentTime = 0;
                await video7.play();
            }
        } catch (err) {
            console.log("Video play failed:", err);
        }
    }
};

window.App = App;

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await App.init();
    } catch (error) {
        console.error("Failed to initialize app:", error);
    }
});
