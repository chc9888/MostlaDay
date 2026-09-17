// ml5 body pose (MoveNet, multi-person)
let bodyPose;
let video;
let poses = [];

// sound
let audioStarted = false;
let currentScale = 'major';

// Tone.js instrument
let piano;
let pianoGain;
let reverb;

// Per-hand playing state, keyed by "<personIndex>_<left|right>"
let handStates = {};

// Musical scales
let scales = {
    major: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'],
    minor: ['C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4'],
    pentatonic: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'],
    blues: ['C4', 'Eb4', 'F4', 'F#4', 'G4', 'Bb4', 'C5'],
    dorian: ['C4', 'D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4']
};

// Single color for every tracked hand (MoveNet's per-person index isn't
// stable between frames, so per-person colors would flicker/swap anyway)
const HAND_COLOR = [255, 200, 100];

const MAX_PEOPLE = 4;
// MoveNet keeps reporting a low-confidence "best guess" position for a
// keypoint even when it's occluded or off-frame, so this needs to be high
// enough to actually drop a hand once it's no longer visible.
const MIN_CONFIDENCE = 0.35;

// Canvas zones (7 parts for 7 notes)
const numZones = 7;
let zoneWidth;

function preload() {
    // MoveNet defaults to MULTIPOSE_LIGHTNING, which tracks several people at once.
    bodyPose = ml5.bodyPose('MoveNet', { flipped: true, modelType: 'MULTIPOSE_LIGHTNING' });
}

function setup() {
    createCanvas(640, 480);
    select('canvas').parent('rightDiv');
    video = createCapture(VIDEO, videoReady);
    video.size(640, 480);
    video.hide();

    zoneWidth = width / numZones;

    setupAudio();
    setupUI();
}

function setupAudio() {
    reverb = new Tone.Reverb({ decay: 3, wet: 0.4 }).toDestination();

    pianoGain = new Tone.Gain(0.8).toDestination();
    piano = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 10,
        envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 1.0 }
    }).connect(pianoGain);
    pianoGain.connect(reverb);
}

function setupUI() {
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

    document.getElementById('scaleSelect').addEventListener('change', (e) => {
        currentScale = e.target.value;
    });
}

function videoReady() {
    console.log('Video ready');
    bodyPose.detectStart(video, gotPoses);
    document.getElementById('status').textContent = '';
}

function gotPoses(results) {
    poses = results;
}

function draw() {
    // Draw video (mirrored)
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();

    let instructions = null;

    if (poses.length > 0 && audioStarted) {
        instructions = 'Press "Stop" to stop playing';
        textAlign(CENTER, CENTER);
        textSize(14);
        fill(255, 255, 255, 200);
        noStroke();
        text(instructions, width / 2, height - (height / 10));

        let activeZones = [];
        let activeKeys = new Set();

        let people = poses.slice(0, MAX_PEOPLE);
        for (let p = 0; p < people.length; p++) {
            let pose = people[p];

            let wrists = { left: getHandPoint(pose, 'left'), right: getHandPoint(pose, 'right') };
            for (let side in wrists) {
                let wrist = wrists[side];
                if (!wrist || wrist.confidence < MIN_CONFIDENCE) continue;

                let key = `${p}_${side}`;
                activeKeys.add(key);

                let zone = getZone(wrist.x);
                let octave = 5 - Math.floor(wrist.y / (height / 3));
                octave = constrain(octave, 3, 5);

                activeZones.push({ zone: zone, octave: octave });

                drawWrist(wrist.x, wrist.y, HAND_COLOR);
                playNoteForHand(key, zone, octave);
            }
        }

        // Stop notes for hands that disappeared or dropped confidence
        for (let key in handStates) {
            if (!activeKeys.has(key)) {
                stopNoteForHand(key);
            }
        }

        drawZones(activeZones);

    } else {
        drawZones();
        stopAllNotes();

        textAlign(CENTER, CENTER);
        textSize(18);
        fill(255, 255, 255, 200);
        noStroke();

        if (!audioStarted) {
            instructions = 'Click "Start" to play';
        } else {
            instructions = 'Move your hands in front of the camera (up to 4 people)';
        }

        text(instructions, width / 2, height / 2);
    }
}

function drawZones(activeZones = []) {
    stroke(255, 255, 255, 100);
    strokeWeight(2);

    // Note lines
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

        let isActive = false;
        let activeOctave = null;

        for (let j = 0; j < activeZones.length; j++) {
            if (activeZones[j].zone === i) {
                isActive = true;
                activeOctave = activeZones[j].octave;
                break;
            }
        }

        let baseNote = baseNotes[i];
        let noteName = baseNote.replace(/[0-9]/g, '');

        let displayText = noteName;

        if (isActive) {
            fill(255, 200, 100);
            displayText = noteName + activeOctave;
        } else {
            fill(255, 255, 255, 200);
            displayText = noteName;
        }

        text(displayText, x, 10);
    }
}

function drawWrist(x, y, color = [255, 200, 100]) {
    noStroke();
    fill(color[0], color[1], color[2], 80);
    circle(x, y, 50);
    fill(color[0], color[1], color[2], 150);
    circle(x, y, 30);
    fill(255, 255, 255);
    circle(x, y, 15);

    stroke(color[0], color[1], color[2], 200);
    strokeWeight(2);
    line(x - 20, y, x + 20, y);
    line(x, y - 20, x, y + 20);
}

function getZone(x) {
    return constrain(floor(x / zoneWidth), 0, numZones - 1);
}

// MoveNet only gives a wrist joint, not a hand center, so approximate the
// palm by extending past the wrist along the forearm's direction.
const HAND_OFFSET = 40;

function getHandPoint(pose, side) {
    let wrist = pose[side + '_wrist'];
    if (!wrist || wrist.confidence < MIN_CONFIDENCE) return wrist;

    let elbow = pose[side + '_elbow'];
    if (!elbow || elbow.confidence < MIN_CONFIDENCE) return wrist;

    let dx = wrist.x - elbow.x;
    let dy = wrist.y - elbow.y;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return wrist;

    return {
        x: wrist.x + (dx / len) * HAND_OFFSET,
        y: wrist.y + (dy / len) * HAND_OFFSET,
        confidence: wrist.confidence
    };
}

function playNoteForHand(key, zone, octave) {
    const baseNotes = scales[currentScale];
    let baseNote = baseNotes[zone];
    let noteName = baseNote.replace(/[0-9]/g, '');
    let note = noteName + octave;

    let state = handStates[key];

    // Only re-trigger if the zone or octave changed for this hand
    if (!state || state.zone !== zone || state.octave !== octave) {
        if (state) {
            piano.triggerRelease(state.note);
        }
        piano.triggerAttack(note);
        handStates[key] = { note: note, zone: zone, octave: octave };
    }
}

function stopNoteForHand(key) {
    let state = handStates[key];
    if (state) {
        piano.triggerRelease(state.note);
        delete handStates[key];
    }
}

function stopAllNotes() {
    for (let key in handStates) {
        stopNoteForHand(key);
    }
}
