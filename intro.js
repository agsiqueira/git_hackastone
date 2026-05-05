// ===== principal functions ===== //
function navigateToIntro(targetIntro, currentVideoId, nextVideoId) {
    //hide all sections first
    for (let i = 1; i <= 6; i++) {
        const section = document.getElementById(`back_intro${i}`);
        if (section) section.style.display = "none";
    }
    
    //show target section
    const targetSection = document.getElementById(`back_intro${targetIntro}`);
    if (targetSection) targetSection.style.display = "flex";
    
    //updt navigation controls
    updateNavigationControls(targetIntro);
    
    //pause current video if exists
    if (currentVideoId) {
        const currentVideo = document.getElementById(currentVideoId);
        if (currentVideo) currentVideo.pause();
    }
    
    //enable typewriter for next video if exists
    if (nextVideoId) {
        const nextVideo = document.getElementById(nextVideoId);
        if (nextVideo) {
            nextVideo.currentTime = 0;
            nextVideo.play().catch(e => console.log("Autoplay prevented:", e));
        }
    }
    
    //manage interface visibility
    if (targetIntro === 3) {
        document.getElementById('interface').style.display = "flex";
    } else {
        document.getElementById('interface').style.display = "none";
    }
}

function updateNavigationControls(targetIntro) {
    //hide all controls first
    const navButtons = [
        'tointro2', 'tointro3', 'tointro4', 'tointro5', 'tointro6',
        'backtointro1', 'backtointro2', 'backtointro3', 'backtointro4', 'backtointro5',
    ];
    
    navButtons.forEach(btn => {
        const element = document.getElementById(btn);
        if (element) element.style.display = "none";
    });
    
    //show controls appropriate for the current section
    switch(targetIntro) {
        case 1:
            document.getElementById('tointro2').style.display = "block";
            break;
        case 2:
            document.getElementById('backtointro1').style.display = "block";
            document.getElementById('tointro3').style.display = "block";
            break;
        case 3:
            document.getElementById('backtointro2').style.display = "block";
            document.getElementById('tointro4').style.display = "block";
            break;
        case 4:
            document.getElementById('backtointro3').style.display = "block";
            document.getElementById('tointro5').style.display = "block";
            break;
        case 5:
            document.getElementById('backtointro4').style.display = "block";
            document.getElementById('tointro6').style.display = "block";
            break;
        case 6:
            document.getElementById('backtointro5').style.display = "block";
            break;
    }
}

// ===== functions of navigation ===== //
function goToIntroN(n) {
navigateToIntro(n, `myVideo${n-1}`, `myVideo${n}`);
}

function goBackIntroN(n) {
navigateToIntro(n, `myVideo${n+1}`, `myVideo${n}`)
}

// ===== add+ functions ===== //
function startEvent() {
    window.parent.document.getElementById('btn-clickagree').click();
}

function startInteract() {
    document.getElementById('myVideo6').pause();
    const beep = document.getElementById("beepAudio");
    if (beep) beep.play();
    window.parent.document.getElementById('intro').style.display = "none";
}

function startVideo() {
    const video1 = document.getElementById('myVideo1');
    const startButton = document.getElementById('startButton');

    if (video1) {
        video1.play();
        video1.muted = false;
        if (startButton) startButton.style.display = 'none';
    }
}

// ===== main initialization ===== //
window.onload = function() {
    //activate for the first video
    const video1 = document.getElementById('myVideo1');
    if (video1) {
        video1.muted = true;
        const playPromise = video1.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                video1.muted = true;
                video1.play()
                    .then(() => {
                        video1.muted = false;
                    })
                    .catch(e => console.log("Autoplay completamente bloqueado:", e));
            });
        }
    }

    const video5 = document.getElementById("myVideo5");
    video5.addEventListener('ended', function() {
        document.getElementById('button-container-5').style.display = 'block';
    });

    const video6 = document.getElementById("myVideo6");
    video6.addEventListener('ended', function() {
        document.getElementById('button-container-6').style.display = 'block';
    });
    
    //pause other videos
    ['myVideo2', 'myVideo3', 'myVideo4', 'myVideo5', 'myVideo6'].forEach(id => {
        const video = document.getElementById(id);
        if (video) video.pause();
    });

    navigateToIntro(1, null, null);
};