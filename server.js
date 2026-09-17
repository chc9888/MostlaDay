const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Serve static files
app.use(express.static('public'));

// Store connected users
let users = {};
let currentScale = 'major'; // Global scale
const MAX_PLAYERS = 4;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Check if orchestra is full
    let activePlayers = Object.keys(users).length;
    let isFull = activePlayers >= MAX_PLAYERS;
    
    // Send current state to new user
    socket.emit('currentState', {
        users: users,
        currentScale: currentScale,
        isFull: isFull,
        isListener: isFull
    });
    
    // If orchestra is full, mark as listener only
    if (isFull) {
        console.log(`Orchestra full. User ${socket.id} is listener only.`);
    } else {
        // Add user as player (everyone uses piano)
        users[socket.id] = { 
            instrument: 'piano',
            isActive: true
        };
        
        // Broadcast updated state to everyone
        io.emit('updateUsers', {
            users: users
        });
    }
    
    // Global scale change
    socket.on('changeScale', (scale) => {
        if (!users[socket.id]) {
            return; // Listeners can't change scale
        }
        
        currentScale = scale;
        console.log(`User ${socket.id} changed scale to ${scale}`);
        
        // Broadcast to everyone
        io.emit('scaleChanged', scale);
    });
    
    // NEW: Real-time hand position updates
    socket.on('handUpdate', (data) => {
        if (!users[socket.id]) {
            return;
        }
        
        socket.broadcast.emit('handUpdate', {
            userId: socket.id,
            handIndex: data.handIndex,
            handX: data.handX,
            handY: data.handY,
            zone: data.zone,
            octave: data.octave
        });
    });
    
    // NEW: Hands removed notification
    socket.on('handsRemoved', () => {
        if (!users[socket.id]) {
            return;
        }
        
        socket.broadcast.emit('handRemoved', {
            userId: socket.id,
            handIndex: 0
        });
        socket.broadcast.emit('handRemoved', {
            userId: socket.id,
            handIndex: 1
        });
    });
    
    // When a user plays a note
    socket.on('playNote', (data) => {
        if (!users[socket.id]) {
            return;
        }
        
        socket.broadcast.emit('remotePlayNote', {
            userId: socket.id,
            instrument: 'piano',
            note: data.note,
            volume: data.volume,
            zone: data.zone,
            octave: data.octave,
            handIndex: data.handIndex
        });
    });
    
    // When a user stops a note
    socket.on('stopNote', (data) => {
        if (!users[socket.id]) {
            return;
        }
        
        socket.broadcast.emit('remoteStopNote', {
            userId: socket.id,
            instrument: 'piano',
            note: data.note,
            handIndex: data.handIndex
        });
    });
    
    // When user disconnects
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (users[socket.id]) {
            delete users[socket.id];
            
            // Broadcast updated state
            io.emit('updateUsers', {
                users: users
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});