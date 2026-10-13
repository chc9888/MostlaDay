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

// Musical scales (the octave digit is relative: "4" means the octave of the
// row the hand is in, "5" means one above it)
let scales = {
    major: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'],
    minor: ['C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4'],
    pentatonic: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'],
    blues: ['C4', 'Eb4', 'F4', 'F#4', 'G4', 'Bb4', 'C5'],
    dorian: ['C4', 'D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4']
};

// Palette
const DARK = [13, 50, 102];    // #0d3266
const LIGHT = [175, 225, 224]; // #afe1e0

const MAX_PEOPLE = 4;
// MoveNet keeps reporting a low-confidence "best guess" position for a
// keypoint even when it's occluded or off-frame, so this needs to be high
// enough to actually drop a hand once it's no longer visible.
const MIN_CONFIDENCE = 0.35;

// Hand tracking across frames. MoveNet's person order isn't stable between
// frames, so hands are matched to the nearest hand from the previous frame
// instead of being identified by person index.
const MATCH_DISTANCE = 120; // px a hand may move between frames and still be "the same hand"
const MISS_GRACE_FRAMES = 2; // frames a hand may go undetected before its note stops
let trackedHands = [];       // { id, x, y, missed, note }
let nextHandId = 0;

// How many hands are currently holding each pitch, so one hand leaving
// doesn't silence another hand on the same note.
let noteHolders = {};

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

    // Light navy wash so the grid and labels read over any background
    noStroke();
    fill(DARK[0], DARK[1], DARK[2], 70);
    rect(0, 0, width, height);

    if (poses.length > 0 && audioStarted) {
        updateTrackedHands(detectHands());

        let activeZones = [];
        for (let hand of trackedHands) {
            if (hand.missed > 0) continue; // holding through a brief dropout

            let zone = getZone(hand.x);
            let octave = constrain(5 - Math.floor(hand.y / (height / 3)), 3, 5);
            let note = noteFor(zone, octave);

            activeZones.push({ zone: zone, note: note });
            drawHand(hand.x, hand.y);
            setHandNote(hand, note);
        }

        drawZones(activeZones);
        drawMessage('Press "Stop" to stop playing', height - height / 10, 14);
    } else {
        drawZones();
        stopAllNotes();

        if (!audioStarted) {
            drawMessage('Click "Start" to play', height / 2, 18);
        } else {
            drawMessage('Move your hands in front of the camera (up to 4 people)', height / 2, 18);
        }
    }
}

// Every confidently detected hand in this frame, as {x, y}.
function detectHands() {
    let detections = [];
    for (let pose of poses.slice(0, MAX_PEOPLE)) {
        for (let side of ['left', 'right']) {
            let point = getHandPoint(pose, side);
            if (point && point.confidence >= MIN_CONFIDENCE) {
                detections.push({ x: point.x, y: point.y });
            }
        }
    }
    return detections;
}

// Match this frame's detections to last frame's hands, closest pairs first.
function updateTrackedHands(detections) {
    let pairs = [];
    for (let t = 0; t < trackedHands.length; t++) {
        for (let d = 0; d < detections.length; d++) {
            let distance = dist(trackedHands[t].x, trackedHands[t].y, detections[d].x, detections[d].y);
            if (distance <= MATCH_DISTANCE) pairs.push({ t, d, distance });
        }
    }
    pairs.sort((a, b) => a.distance - b.distance);

    let matchedHands = new Set();
    let usedDetections = new Set();
    for (let { t, d } of pairs) {
        if (matchedHands.has(t) || usedDetections.has(d)) continue;
        matchedHands.add(t);
        usedDetections.add(d);
        trackedHands[t].x = detections[d].x;
        trackedHands[t].y = detections[d].y;
        trackedHands[t].missed = 0;
    }

    // Hands that weren't seen this frame: wait a couple of frames, then let go
    for (let t = 0; t < trackedHands.length; t++) {
        if (!matchedHands.has(t)) trackedHands[t].missed++;
    }
    for (let hand of trackedHands) {
        if (hand.missed > MISS_GRACE_FRAMES) setHandNote(hand, null);
    }
    trackedHands = trackedHands.filter(hand => hand.missed <= MISS_GRACE_FRAMES);

    // New hands
    for (let d = 0; d < detections.length; d++) {
        if (usedDetections.has(d)) continue;
        trackedHands.push({ id: nextHandId++, x: detections[d].x, y: detections[d].y, missed: 0, note: null });
    }
}

function drawZones(activeZones = []) {
    stroke(LIGHT[0], LIGHT[1], LIGHT[2], 110);
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

    // Note labels at top of each zone
    noStroke();
    textAlign(CENTER, TOP);
    textSize(24);
    textStyle(BOLD);

    const baseNotes = scales[currentScale];
    for (let i = 0; i < numZones; i++) {
        let x = i * zoneWidth + zoneWidth / 2;
        let active = activeZones.find(z => z.zone === i);

        if (active) {
            fill(LIGHT[0], LIGHT[1], LIGHT[2]);
            rect(i * zoneWidth + 4, 4, zoneWidth - 8, 36, 8);
            fill(DARK[0], DARK[1], DARK[2]);
            text(active.note, x, 10);
        } else {
            fill(LIGHT[0], LIGHT[1], LIGHT[2], 220);
            text(splitNote(baseNotes[i]).name, x, 10);
        }
    }
    textStyle(NORMAL);
}

function drawMessage(message, y, size) {
    textAlign(CENTER, CENTER);
    textSize(size);
    noStroke();
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 230);
    text(message, width / 2, y);
}

function drawHand(x, y) {
    noStroke();
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 80);
    circle(x, y, 50);
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 170);
    circle(x, y, 30);
    fill(DARK[0], DARK[1], DARK[2]);
    circle(x, y, 15);

    stroke(DARK[0], DARK[1], DARK[2], 220);
    strokeWeight(2);
    line(x - 20, y, x + 20, y);
    line(x, y - 20, x, y + 20);
}

function getZone(x) {
    return constrain(floor(x / zoneWidth), 0, numZones - 1);
}

function splitNote(note) {
    let match = note.match(/^([A-G][#b]?)(\d)$/);
    return { name: match[1], octave: parseInt(match[2]) };
}

// The pitch for a zone in the given octave row, keeping notes written an
// octave up in the scale (e.g. pentatonic's C5) above the rest.
function noteFor(zone, octave) {
    let { name, octave: scaleOctave } = splitNote(scales[currentScale][zone]);
    return name + (octave + scaleOctave - 4);
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

// Move a hand to a new note (or to null to stop). Pitches are shared:
// a pitch starts when its first hand arrives and stops when its last hand leaves.
function setHandNote(hand, note) {
    if (hand.note === note) return;
    if (hand.note) releaseNote(hand.note);
    if (note) holdNote(note);
    hand.note = note;
}

function holdNote(note) {
    noteHolders[note] = (noteHolders[note] || 0) + 1;
    if (noteHolders[note] === 1) piano.triggerAttack(note);
}

function releaseNote(note) {
    if (!noteHolders[note]) return;
    noteHolders[note]--;
    if (noteHolders[note] === 0) {
        delete noteHolders[note];
        piano.triggerRelease(note);
    }
}

function stopAllNotes() {
    for (let hand of trackedHands) setHandNote(hand, null);
    trackedHands = [];
}
