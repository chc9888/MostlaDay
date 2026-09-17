// Socket.IO connection
let socket;

// Remote players
let remotePlayers = {};
let remoteHands = {};
let isListener = false;
let userColors = {};

// ml5
let handPose;
let video;
let hands = [];

// sound
let audioStarted = false;
let selectedInstrument = 'piano';
let currentScale = 'major';

// Tone.js instruments
let piano, violin, flute, drums;
let pianoGain, violinGain, fluteGain, drumsGain;
let reverb;

// Scale 
let octave;
let currentNotes = [null, null];
let currentNote = null;
let lastZones = [-1, -1];
let lastOctaves = [-1, -1];

// Musical scales
let scales = {
    major: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'],
    minor: ['C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4'],
    pentatonic: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'],
    blues: ['C4', 'Eb4', 'F4', 'F#4', 'G4', 'Bb4', 'C5'],
    dorian: ['C4', 'D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4']
};

// Canvas zones (7 parts for 7 notes)
const numZones = 7;
let zoneWidth;

function preload() {
    handPose = ml5.handPose({ flipped: true });
}

function setup() {
    createCanvas(640, 480);
    select('canvas').parent('rightDiv');
    video = createCapture(VIDEO, videoReady);
    video.size(640, 480);
    video.hide();

    zoneWidth = width / numZones;

    setupAudio();
    setupSocket();
    setupUI();
}

function setupAudio() {
    // Create reverb for atmosphere
    reverb = new Tone.Reverb({ decay: 3, wet: 0.4 }).toDestination();

    // PIANO - Rich, warm piano sound
    pianoGain = new Tone.Gain(0.8).toDestination();
    piano = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 10,
        envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 1.0 }
    }).connect(pianoGain);
    pianoGain.connect(reverb);
}

function setupSocket() {
    socket = io();

    // Get your own socket ID and assign orange color
    socket.on('connect', () => {
        console.log('My socket ID:', socket.id);
        userColors[socket.id] = [255, 200, 100]; // Orange for you
    });

    // Receive current state when connecting
    socket.on('currentState', (data) => {
        console.log('Current state received:', data);

        // Check if orchestra is full
        if (data.isFull) {
            isListener = true;
            document.getElementById('status').textContent = 'Orchestra is full - You are listening only';
        }

        // Set global scale
        currentScale = data.currentScale;
        document.getElementById('scaleSelect').value = currentScale;

        // Assign colors to existing users
        let colorIndex = 1; // Start at 1 (you are 0)
        for (let userId in data.users) {
            if (userId !== socket.id && !userColors[userId]) {
                userColors[userId] = assignUserColor(colorIndex);
                console.log(`Assigned color ${colorIndex} to user ${userId}`);
                colorIndex++;
            }
        }
    });

    // Global scale changed by another user
    socket.on('scaleChanged', (scale) => {
        currentScale = scale;
        document.getElementById('scaleSelect').value = scale;
        console.log('Scale changed to:', scale);
    });

    // Update users list
    socket.on('updateUsers', (data) => {
        console.log('Users updated:', data);

        // Assign colors to new users
        let colorIndex = 1;
        for (let userId in data.users) {
            if (userId !== socket.id && !userColors[userId]) {
                userColors[userId] = assignUserColor(colorIndex);
                console.log(`Assigned color ${colorIndex} to new user ${userId}`);
            }
            if (userId !== socket.id) {
                colorIndex++;
            }
        }
    });

    // NEW: Receive hand position updates (separate from note playing)
    socket.on('handUpdate', (data) => {
        // Store remote hand position
        if (!remoteHands[data.userId]) {
            remoteHands[data.userId] = {};
        }
        remoteHands[data.userId][data.handIndex] = {
            x: data.handX,
            y: data.handY,
            zone: data.zone,
            octave: data.octave
        };

        // Assign color to user if not assigned yet
        if (!userColors[data.userId]) {
            let colorIndex = Object.keys(userColors).filter(k => k !== socket.id).length + 1;
            userColors[data.userId] = assignUserColor(colorIndex);
            console.log(`Assigned color ${colorIndex} to user ${data.userId} (from handUpdate)`);
        }
    });

    // Remote player plays note - with hand position
    socket.on('remotePlayNote', (data) => {
        playRemoteNote(data);
    });

    // Remote player stops note
    socket.on('remoteStopNote', (data) => {
        stopRemoteNote(data);
    });

    // NEW: Remote hand removed
    socket.on('handRemoved', (data) => {
        // Remove remote hand position
        if (remoteHands[data.userId] && remoteHands[data.userId][data.handIndex]) {
            delete remoteHands[data.userId][data.handIndex];
        }
    });

    // Error handling
    socket.on('error', (data) => {
        alert(data.message);
    });
}

function assignUserColor(index) {
    const colors = [
        [255, 200, 100], // Orange (index 0 - self)
        [100, 200, 255], // Blue (index 1)
        [100, 255, 150], // Green (index 2)
        [255, 100, 200], // Pink (index 3)
        [200, 100, 255]  // Purple (index 4)
    ];
    return colors[index % colors.length];
}

function drawRemoteHands() {
    // Draw all remote users' hands
    for (let userId in remoteHands) {
        let userHands = remoteHands[userId];
        let color = userColors[userId] || [200, 200, 200];

        for (let handIndex in userHands) {
            let handData = userHands[handIndex];
            drawWrist(handData.x, handData.y, color);
        }
    }
}

function setupUI() {
    // Start/Stop button
    document.getElementById('startBtn').addEventListener('click', async () => {
        if (!audioStarted) {
            await Tone.start();
            audioStarted = true;
            document.getElementById('startBtn').textContent = 'Stop';
        } else {
            stopAllNotes();
            audioStarted = false;
            document.getElementById('startBtn').textContent = 'Start';
        }
    });

    // Scale selection - emit to server
    document.getElementById('scaleSelect').addEventListener('change', (e) => {
        if (!isListener) {
            currentScale = e.target.value;
            socket.emit('changeScale', currentScale);
        } else {
            // Revert if listener
            e.target.value = currentScale;
            alert('Only players can change the scale!');
        }
    });
}

function videoReady() {
    console.log("Video ready");
    handPose.detectStart(video, gotHands);
    document.getElementById('status').textContent = '';
}

function draw() {
    // Draw video (mirrored)
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();

    let instructions = null;

    // Draw remote users' hands FIRST (so they appear behind local hands)
    drawRemoteHands();

    // Process hand input
    if (hands.length > 0 && audioStarted && !isListener) {
        // Collect active zones for all hands
        let activeZones = [];
        
        instructions = 'Press "Stop" to stop playing'; 
        textAlign(CENTER, CENTER);
        textSize(14);
        fill(255, 255, 255, 200);
        noStroke();
        text(instructions, width/2, height-(height/10));

        // Process ALL detected hands
        for (let i = 0; i < hands.length; i++) {
            let hand = hands[i];
            let wrist = hand.keypoints[0];
            let middleBase = hand.keypoints[9];

            let controlX = (wrist.x + middleBase.x) / 2;
            let controlY = (wrist.y + middleBase.y) / 2;

            let zone = getZone(controlX);

            // Calculate octave
            let octave = 5 - Math.floor(controlY / (height / 3));
            octave = constrain(octave, 3, 5);

            // Add to active zones
            activeZones.push({ zone: zone, octave: octave });

            // Draw wrist indicator with your color (orange)
            let myColor = userColors[socket.id] || [255, 200, 100];
            drawWrist(controlX, controlY, myColor);

            // Play note for this hand
            playNoteForHand(i, zone, octave, controlX, controlY);
            
            // NEW: Send hand position update every frame for real-time visualization
            if (socket && frameCount % 2 === 0) { // Send every 2 frames to reduce load
                socket.emit('handUpdate', {
                    handIndex: i,
                    handX: controlX,
                    handY: controlY,
                    zone: zone,
                    octave: octave
                });
            }
        }

        // Draw zones with all active zones highlighted
        drawZones(activeZones);

    } else {
        drawZones();

        if (!isListener) {
            stopAllNotes();
            
            // NEW: Notify server that hands are removed
            if (socket && hands.length === 0) {
                socket.emit('handsRemoved');
            }
        }

        // Instructions
        textAlign(CENTER, CENTER);
        textSize(18);
        fill(255, 255, 255, 200);
        noStroke();

        if (isListener) {
            instructions = 'The orchestra is full.\nYou can stay to listen and watch!';
        } else if (!audioStarted) {
            instructions = 'Click "Start" to play';
        } else {
            instructions = 'Move your hands in front of the camera';
        }

        text(instructions, width / 2, height / 2);
    }
}

function drawZones(activeZones = []) {
    stroke(255, 255, 255, 100);
    strokeWeight(2);

    // Notes lines
    for (let i = 1; i < numZones; i++) {
        let x = i * zoneWidth;
        line(x, 0, x, height);
    }

    // Octave lines
    for (let i = 1; i < 3; i++) {
        let y = (height / 3) * i;
        line(0, y, width, y);
    }

    // Draw note labels at top of each zone
    noStroke();
    textAlign(CENTER, TOP);
    textSize(24);
    textStyle(BOLD);

    const baseNotes = scales[currentScale];
    for (let i = 0; i < numZones; i++) {
        let x = i * zoneWidth + zoneWidth / 2;

        // Check if this zone is active for any hand
        let isActive = false;
        let activeOctave = null;

        for (let j = 0; j < activeZones.length; j++) {
            if (activeZones[j].zone === i) {
                isActive = true;
                activeOctave = activeZones[j].octave;
                break;
            }
        }

        // Get note name
        let baseNote = baseNotes[i];
        let noteName = baseNote.replace(/[0-9]/g, '');

        // If active, show note+octave, otherwise just note name
        let displayText = noteName;

        // Change color if active
        if (isActive) {
            fill(255, 200, 100); // Orange for active
            displayText = noteName + activeOctave;
        } else {
            fill(255, 255, 255, 200); // White for inactive
            displayText = noteName
        }

        text(displayText, x, 10);
    }
}

function drawWrist(x, y, color = [255, 200, 100]) {
    // Glow effect
    noStroke();
    fill(color[0], color[1], color[2], 80);
    circle(x, y, 50);
    fill(color[0], color[1], color[2], 150);
    circle(x, y, 30);
    fill(255, 255, 255);
    circle(x, y, 15);

    // Crosshair
    stroke(color[0], color[1], color[2], 200);
    strokeWeight(2);
    line(x - 20, y, x + 20, y);
    line(x, y - 20, x, y + 20);
}

function getZone(x) {
    return constrain(floor(x / zoneWidth), 0, numZones - 1);
}

function playNoteForHand(handIndex, zone, octave, x, y) {
    const baseNotes = scales[currentScale];

    let baseNote = baseNotes[zone];
    let noteName = baseNote.replace(/[0-9]/g, '');
    let note = noteName + octave;

    // Only trigger if zone or octave changed for THIS hand
    if (zone !== lastZones[handIndex] || octave !== lastOctaves[handIndex]) {
        // Stop previous note for this hand
        stopNoteForHand(handIndex);

        // Play new note
        switch (selectedInstrument) {
            case 'piano':
                piano.triggerAttack(note);
                break;
            case 'violin':
                violin.triggerAttack(note);
                break;
            case 'flute':
                flute.triggerAttack(note);
                break;
            case 'drums':
                let drumPitch = note.replace(/[0-9]/, '1');
                drums.triggerAttackRelease(drumPitch, "8n");
                break;
        }

        currentNotes[handIndex] = note;
        lastZones[handIndex] = zone;
        lastOctaves[handIndex] = octave;

        // Emit to other players WITH hand position
        if (socket) {
            socket.emit('playNote', {
                instrument: selectedInstrument,
                note: note,
                volume: -10,
                zone: zone,
                octave: octave,
                handIndex: handIndex,
                handX: x,  // NEW
                handY: y   // NEW
            });
        }
    }
}

function stopNoteForHand(handIndex) {
    let note = currentNotes[handIndex];

    if (note && selectedInstrument !== 'drums') {
        switch (selectedInstrument) {
            case 'piano':
                piano.triggerRelease(note);
                break;
            case 'violin':
                violin.triggerRelease(note);
                break;
            case 'flute':
                flute.triggerRelease(note);
                break;
        }

        if (socket && selectedInstrument) {
            socket.emit('stopNote', {
                instrument: selectedInstrument,
                note: note,
                handIndex: handIndex
            });
        }

        currentNotes[handIndex] = null;
    }
    lastZones[handIndex] = -1;
    lastOctaves[handIndex] = -1;
}

function setInstrumentVolume(volumeDb) {
    // Convert dB to linear scale
    const linearVolume = Math.pow(10, volumeDb / 20);

    switch (selectedInstrument) {
        case 'piano':
            pianoGain.gain.rampTo(linearVolume * 0.8, 0.05);
            break;
        case 'violin':
            violinGain.gain.rampTo(linearVolume * 0.6, 0.05);
            break;
        case 'flute':
            fluteGain.gain.rampTo(linearVolume * 0.5, 0.05);
            break;
        case 'drums':
            drumsGain.gain.rampTo(linearVolume * 0.9, 0.05);
            break;
    }
}

function stopCurrentNote() {
    if (currentNote && selectedInstrument !== 'drums') {
        switch (selectedInstrument) {
            case 'piano':
                piano.triggerRelease(currentNote);
                break;
            case 'violin':
                violin.triggerRelease(currentNote);
                break;
            case 'flute':
                flute.triggerRelease(currentNote);
                break;
        }

        if (selectedInstrument) {
            socket.emit('stopNote', {
                instrument: selectedInstrument,
                note: currentNote
            });
        }

        currentNote = null;
    }
    lastZone = -1;
    lastOctave = -1;
}

function stopAllNotes() {
    for (let i = 0; i < 2; i++) {
        stopNoteForHand(i);
    }
}

function displayInfo(zone, octave) {
    const baseNotes = scales[currentScale];
    let baseNote = baseNotes[zone];
    let noteName = baseNote.replace(/[0-9]/g, '');
    let fullNote = noteName + octave;

    fill(255);
    stroke(0);
    strokeWeight(3);
    textAlign(LEFT, BOTTOM);
    textSize(18);
    text(`Note: ${fullNote}  |  Octave: ${octave}`, 10, height - 10);
}

function gotHands(results) {
    // Store previous hand count
    let previousHandCount = hands.length;
    hands = results;

    // If hand count decreased, stop notes for missing hands
    if (results.length < previousHandCount) {
        for (let i = results.length; i < previousHandCount; i++) {
            stopNoteForHand(i);
        }
    }

    // If no hands, stop all
    if (results.length === 0) {
        stopAllNotes();
    }
}

function playRemoteNote(data) {
    // Use fixed volume for remote notes
    const linearVolume = 0.5; // Medium volume

    switch (data.instrument) {
        case 'piano':
            pianoGain.gain.rampTo(linearVolume * 0.8, 0.05);
            piano.triggerAttack(data.note);
            break;
        case 'violin':
            violinGain.gain.rampTo(linearVolume * 0.6, 0.05);
            violin.triggerAttack(data.note);
            break;
        case 'flute':
            fluteGain.gain.rampTo(linearVolume * 0.5, 0.05);
            flute.triggerAttack(data.note);
            break;
        case 'drums':
            drumsGain.gain.rampTo(linearVolume * 0.9, 0.05);
            let drumPitch = data.note.replace(/[0-9]/, '1');
            drums.triggerAttackRelease(drumPitch, "8n");
            break;
    }

    if (!remotePlayers[data.userId]) {
        remotePlayers[data.userId] = {};
    }
    remotePlayers[data.userId][data.instrument] = data.note;
}

function stopRemoteNote(data) {
    if (data.instrument !== 'drums') {
        switch (data.instrument) {
            case 'piano':
                piano.triggerRelease(data.note);
                break;
            case 'violin':
                violin.triggerRelease(data.note);
                break;
            case 'flute':
                flute.triggerRelease(data.note);
                break;
        }
    }

    // Clean up reference
    if (remotePlayers[data.userId]) {
        delete remotePlayers[data.userId][data.instrument];
    }
}