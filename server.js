const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    let extname = String(path.extname(filePath)).toLowerCase();
    let mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
    };
    let contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const wss = new WebSocket.Server({ server });


const rooms = new Map();
const DEFAULT_ROUND_COUNT = 5;
const MAX_EMOJI_COUNT = 5;
const MIN_EMOJI_COUNT = 3;
const EMOJI_SELECTION_TIME = 30; 
const GUESSING_WINDOW_TIME = 60; 
const HINT_INTERVAL = 15; 
const ROUND_TRANSITION_TIME = 10; 


const GAME_MODES = {
    STANDARD: 'standard', 
    STORY: 'story'        
};

const prompts = [
    // Tech commands
    "restart computer", "charge battery", "save file", "delete email",
    "update software", "open website", "search internet", "download app",
    "print document", "send message", "lock screen", "backup data",
    "take photo", "share link", "copy paste", "power off",
    "connect wifi", "mute sound", "charge phone", "scan document",
    
    // Cyber-security terms
    "data backup", "password reset", "secure login", "email virus",
    "secure payment", "online banking", "digital wallet", "screen lock", 
    "face unlock", "cloud storage", "data sharing", "virus scan",
    "email filter", "web browser", "safe mode", "system crash",
    "security check", "online shopping", "voice search", "browser history",
    
    // Tech phrases
    "machine learning", "smart home", "virtual meeting", "data science",
    "phone battery", "video chat", "digital money", "online course",
    "wireless charging", "voice assistant", "photo editing", "video game",
    "music streaming", "remote work", "online shopping", "digital camera",
    "mobile payment", "web design", "video call", "social media"
];

const storyPrompts = [
    "Once upon a time", "In a distant galaxy", "Deep in the forest", 
    "On a stormy night", "Under the sea", "In a magical kingdom",
    "During an adventure", "In the ancient temple", "Aboard a space station",
    "Inside a secret lab", "Beyond the mountains", "Through the portal",
    "When time stopped", "In the hidden village", "Beneath the surface",
    "Between dimensions", "Among the stars", "Across the desert",
    "Within the dream", "Before the dawn", "After the storm"
];

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms.has(code)); 
    return code;
}

function broadcast(roomCode, message, sender) {
    const room = rooms.get(roomCode);
    if (room) {
        room.players.forEach((playerInfo, client) => {
            if (client !== sender && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

function broadcastToAll(roomCode, message) {
    const room = rooms.get(roomCode);
    if (room) {
        room.players.forEach((playerInfo, client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

function getPlayerList(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return [];
    return Array.from(room.players.entries()).map(([client, p]) => ({
        name: p.name,
        id: p.id,
        score: p.score || 0,
        isEmojier: p.id === room.currentEmojier,
        isHost: p.isHost || false,
        isStoryCreator: p.id === room.storyCreator
    }));
}

function getRandomPrompt(gameMode = GAME_MODES.STANDARD) {
    if (gameMode === GAME_MODES.STORY) {
        return storyPrompts[Math.floor(Math.random() * storyPrompts.length)];
    }
    return prompts[Math.floor(Math.random() * prompts.length)];
}

function startNewRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    
    clearTimeout(room.roundTimer);
    clearTimeout(room.hintTimer);
    
    
    room.currentRound++;
    
    
    if (room.currentRound > room.totalRounds) {
        
        const finalScores = getPlayerList(roomCode).sort((a, b) => b.score - a.score);
        broadcastToAll(roomCode, {
            type: 'gameOver',
            scores: finalScores,
            winner: finalScores[0],
            storyChain: room.gameMode === GAME_MODES.STORY ? room.storyChain : null
        });
        return;
    }
    
    
    const playerIds = Array.from(room.players.values()).map(p => p.id);
    
    if (room.gameMode === GAME_MODES.STANDARD) {
        const nextEmojierIndex = playerIds.indexOf(room.currentEmojier) + 1;
        room.currentEmojier = playerIds[nextEmojierIndex % playerIds.length];
        room.storyCreator = null;
    } else {
        
        const nextCreatorIndex = playerIds.indexOf(room.storyCreator) + 1;
        room.storyCreator = playerIds[nextCreatorIndex % playerIds.length];
        room.currentEmojier = null;
    }
    
    
    room.selectedEmojis = [];
    room.revealedHints = '';
    room.guessedPlayers = new Set();
    room.roundPhase = 'prep'; 
    
    
    broadcastToAll(roomCode, {
        type: 'newRound',
        round: room.currentRound,
        totalRounds: room.totalRounds,
        currentEmojier: room.currentEmojier,
        storyCreator: room.storyCreator,
        gameMode: room.gameMode,
        players: getPlayerList(roomCode)
    });
    
    
    if (room.gameMode === GAME_MODES.STORY) {
        
        const storyCreatorClient = Array.from(room.players.entries()).find(([_, p]) => p.id === room.storyCreator)?.[0];
        
        if (storyCreatorClient && storyCreatorClient.readyState === WebSocket.OPEN) {
            storyCreatorClient.send(JSON.stringify({
                type: 'promptAssigned',
                prompt: "Create a story prompt"
            }));
        }
        
        
        room.roundTimer = setTimeout(() => {
            if (room.currentPrompt) {
                startEmojiSelectionPhase(roomCode);
            } else {
                
                room.currentPrompt = getRandomPrompt(GAME_MODES.STORY);
                createNewStoryPrompt(roomCode, room.currentPrompt);
                startEmojiSelectionPhase(roomCode);
            }
        }, 20000); 
    } else {
        
        room.currentPrompt = getRandomPrompt();
        
        
        const emojierClient = Array.from(room.players.entries()).find(([_, p]) => p.id === room.currentEmojier)?.[0];
        if (emojierClient && emojierClient.readyState === WebSocket.OPEN) {
            emojierClient.send(JSON.stringify({
                type: 'promptAssigned',
                prompt: room.currentPrompt
            }));
        }
        
        
        room.roundTimer = setTimeout(() => {
            startEmojiSelectionPhase(roomCode);
        }, 5000); 
    }
}

function createNewStoryPrompt(roomCode, prompt) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const storyCreator = Array.from(room.players.values()).find(p => p.id === room.storyCreator);
    if (!storyCreator) return;
    
    room.currentPrompt = prompt;
    
    
    const storyItem = {
        prompt: prompt,
        emojis: [],
        creatorId: storyCreator.id,
        creatorName: storyCreator.name,
        guess: null,
        guesserId: null,
        guesserName: null
    };
    
    room.storyChain.push(storyItem);
    
    
    broadcastToAll(roomCode, {
        type: 'storyPromptCreated',
        prompt: prompt,
        creatorId: storyCreator.id,
        creatorName: storyCreator.name,
        storyItem: storyItem
    });
    
    return storyItem;
}

function startEmojiSelectionPhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.roundPhase = 'emoji-selection';
    broadcastToAll(roomCode, {
        type: 'emojiSelectionPhase',
        timeLimit: EMOJI_SELECTION_TIME
    });
    
    
    room.roundTimer = setTimeout(() => {
        if (room.roundPhase === 'emoji-selection') {
            startGuessingPhase(roomCode);
        }
    }, EMOJI_SELECTION_TIME * 1000);
}

function startGuessingPhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    
    if (room.selectedEmojis.length < MIN_EMOJI_COUNT) {
        
        const commonEmojis = ['🖥️', '📱', '💾', '🔒', '🔓', '💻', '⚙️', '📡'];
        
        
        const storyEmojis = ['📖', '🧙', '🦸', '🌟', '🏰', '🌈', '🔮', '🧚'];
        
        const emojiSet = room.gameMode === GAME_MODES.STORY ? storyEmojis : commonEmojis;
        
        while (room.selectedEmojis.length < MIN_EMOJI_COUNT) {
            const randomEmoji = emojiSet[Math.floor(Math.random() * emojiSet.length)];
            room.selectedEmojis.push(randomEmoji);
        }
        
        
        if (room.gameMode === GAME_MODES.STORY && room.storyChain.length > 0) {
            const currentStoryItem = room.storyChain[room.storyChain.length - 1];
            currentStoryItem.emojis = [...room.selectedEmojis];
        }
    }
    
    room.roundPhase = 'guessing';
    room.hintRevealCount = 0;
    
    
    if (room.gameMode === GAME_MODES.STANDARD) {
        room.promptMask = room.currentPrompt.replace(/[a-zA-Z]/g, '_');
    } else {
        room.promptMask = "Continue the story...";
    }
    
    broadcastToAll(roomCode, {
        type: 'guessingPhase',
        emojis: room.selectedEmojis,
        timeLimit: GUESSING_WINDOW_TIME,
        hint: room.promptMask,
        gameMode: room.gameMode
    });
    
    
    if (room.gameMode === GAME_MODES.STANDARD) {
        room.hintTimer = setTimeout(() => revealHint(roomCode), HINT_INTERVAL * 1000);
    }
    
    
    room.roundTimer = setTimeout(() => {
        endRound(roomCode);
    }, GUESSING_WINDOW_TIME * 1000);
}

function revealHint(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.roundPhase !== 'guessing' || room.gameMode !== GAME_MODES.STANDARD) return;
    
    
    const promptChars = room.currentPrompt.split('');
    const maskChars = room.promptMask.split('');
    
    const hiddenIndices = [];
    for (let i = 0; i < maskChars.length; i++) {
        if (maskChars[i] === '_' && /[a-zA-Z]/.test(promptChars[i])) {
            hiddenIndices.push(i);
        }
    }
    
    if (hiddenIndices.length > 0) {
        
        const revealIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
        maskChars[revealIndex] = promptChars[revealIndex];
        room.promptMask = maskChars.join('');
        room.hintRevealCount++;
        
        broadcastToAll(roomCode, {
            type: 'hintRevealed',
            hint: room.promptMask
        });
        
        
        if (hiddenIndices.length > 1) {
            room.hintTimer = setTimeout(() => revealHint(roomCode), HINT_INTERVAL * 1000);
        }
    }
}

function endRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    
    clearTimeout(room.roundTimer);
    clearTimeout(room.hintTimer);
    
    room.roundPhase = 'reveal';
    
    broadcastToAll(roomCode, {
        type: 'roundEnd',
        prompt: room.currentPrompt,
        emojis: room.selectedEmojis,
        nextRoundIn: ROUND_TRANSITION_TIME,
        players: getPlayerList(roomCode)
    });
    
    
    room.roundTimer = setTimeout(() => {
        startNewRound(roomCode);
    }, ROUND_TRANSITION_TIME * 1000);
}

function calculateScore(isFirst, hintCount, wasQuick, gameMode) {
    let score = 0;
    
    if (gameMode === GAME_MODES.STORY) {
        
        return isFirst ? 8 : 5;
    }
    
    if (isFirst) {
        
        score = Math.max(10 - (2 * hintCount), 4);
        
        
        if (wasQuick) {
            score += 3;
        }
    } else {
        
        score = Math.max(6 - (2 * hintCount), 2);
    }
    
    return score;
}

function generatePlayerId() {
    return Math.random().toString(36).substring(2, 15);
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    let currentRoom = null;
    
    let playerId = generatePlayerId();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data.type);

            switch (data.type) {
                case 'createRoom':
                    playerName = data.name || 'Anonymous';
                    const newRoomCode = generateRoomCode();
                    
                    const newRoom = {
                        players: new Map(),
                        currentRound: 0,
                        totalRounds: data.rounds || DEFAULT_ROUND_COUNT,
                        currentEmojier: null, 
                        storyCreator: null,  
                        currentPrompt: '',
                        selectedEmojis: [],
                        roundPhase: 'waiting', 
                        guessedPlayers: new Set(),
                        hintRevealCount: 0,
                        promptMask: '',
                        gameStarted: false,
                        gameMode: GAME_MODES.STANDARD, 
                        storyChain: [], 
                        roundTimer: null,
                        hintTimer: null
                    };
                    
                    
                    const playerInfo = {
                        name: playerName,
                        id: playerId,
                        score: 0,
                        isHost: true,
                    };
                    
                    newRoom.players.set(ws, playerInfo);
                    rooms.set(newRoomCode, newRoom);
                    currentRoom = newRoomCode;
                    
                    ws.send(JSON.stringify({
                        type: 'roomCreated',
                        roomCode: newRoomCode,
                        players: getPlayerList(newRoomCode),
                        playerId: playerId,
                        isHost: true
                    }));
                    
                    console.log(`Room ${newRoomCode} created by ${playerName}`);
                    break;

                case 'joinRoom':
                    playerName = data.name;
                    const joinCode = data.roomCode?.toUpperCase();
                    const joinRoom = rooms.get(joinCode);
                    if (!joinRoom) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                        break;
                    }
                    const joinPlayerInfo = {
                        name: playerName,
                        id: playerId,
                        score: 0,
                        isHost: false
                    };
                    joinRoom.players.set(ws, joinPlayerInfo);
                    currentRoom = joinCode;
                    ws.send(JSON.stringify({
                        type: 'joinedRoom',
                        roomCode: joinCode,
                        playerId: playerId,
                        isHost: false,
                        players: getPlayerList(joinCode)
                    }));
                    broadcast(joinCode, {
                        type: 'playerJoined',
                        players: getPlayerList(joinCode)
                    }, ws);
                    break;

                case 'startGame':
                    
                    const roomCodeToStart = data.roomCode;
                    console.log(`Received startGame request. Room code: ${roomCodeToStart}, Rounds: ${data.rounds}, Mode: ${data.gameMode}`);
                    
                    if (roomCodeToStart) {
                        const startRoom = rooms.get(roomCodeToStart);
                        console.log(`Room exists: ${!!startRoom}`);
                        
                        
                        const playerInfo = startRoom?.players.get(ws);
                        console.log(`Player info:`, playerInfo ? {
                            name: playerInfo.name,
                            id: playerInfo.id,
                            isHost: playerInfo.isHost
                        } : 'null');
                        
                        if (startRoom && playerInfo && playerInfo.isHost && !startRoom.gameStarted) {
                            console.log(`Starting game in room ${roomCodeToStart}`);
                            
                            startRoom.totalRounds = data.rounds || DEFAULT_ROUND_COUNT;
                            startRoom.gameMode = data.gameMode || GAME_MODES.STANDARD;
                            startRoom.gameStarted = true;
                            startRoom.currentRound = 0; 
                            
                            
                            broadcastToAll(roomCodeToStart, {
                                type: 'gameStarted',
                                players: getPlayerList(roomCodeToStart),
                                rounds: startRoom.totalRounds, 
                                gameMode: startRoom.gameMode, 
                                currentRound: 1 
                            });
                            startNewRound(roomCodeToStart);
                        } else if (startRoom && startRoom.gameStarted) {
                            console.log(`Game already started in room ${roomCodeToStart}`);
                            ws.send(JSON.stringify({ type: 'error', message: 'Game already started.' }));
                        } else if (!playerInfo || !playerInfo.isHost) {
                            console.log(`User is not host in room ${roomCodeToStart}`);
                            ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' }));
                        } else {
                            console.log(`Could not start game in room ${roomCodeToStart}. Unknown error.`);
                            ws.send(JSON.stringify({ type: 'error', message: 'Could not start game.' }));
                        }
                    } else {
                        console.log(`Invalid room code in startGame request`);
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code.' }));
                    }
                    break;
                
                case 'submitGuess':
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (room && room.roundPhase === 'guessing') {
                            console.log(`Received guess from player in room ${currentRoom}`);
                            const playerInfo = room.players.get(ws);
                            const guess = data.guess.trim().toLowerCase();
                            const expectedAnswer = room.currentPrompt.toLowerCase();
                            
                            
                            if (room.guessedPlayers.has(playerInfo.id)) {
                                console.log(`Player ${playerInfo.name} already guessed correctly`);
                                break;
                            }
                            
                            
                            if (guess === expectedAnswer) {
                                console.log(`Correct guess by ${playerInfo.name}: "${guess}"`);
                                
                                room.guessedPlayers.add(playerInfo.id);
                                
                                
                                const isFirstCorrectGuess = room.guessedPlayers.size === 1;
                                const wasQuick = data.timeToGuess < 15; 
                                const scoreEarned = calculateScore(isFirstCorrectGuess, room.hintRevealCount, wasQuick, room.gameMode);
                                
                                
                                playerInfo.score = (playerInfo.score || 0) + scoreEarned;
                                
                                
                                if (room.gameMode === GAME_MODES.STORY && room.storyChain.length > 0) {
                                    const currentStoryItem = room.storyChain[room.storyChain.length - 1];
                                    currentStoryItem.guess = guess;
                                    currentStoryItem.guesserId = playerInfo.id;
                                    currentStoryItem.guesserName = playerInfo.name;
                                }
                                
                                
                                broadcastToAll(currentRoom, {
                                    type: 'correctGuess',
                                    playerId: playerInfo.id,
                                    playerName: playerInfo.name,
                                    isFirst: isFirstCorrectGuess,
                                    scoreEarned: scoreEarned,
                                    players: getPlayerList(currentRoom)
                                });
                                
                                
                                if (isFirstCorrectGuess) {
                                    clearTimeout(room.roundTimer);
                                    clearTimeout(room.hintTimer);
                                    
                                    
                                    room.roundTimer = setTimeout(() => {
                                        endRound(currentRoom);
                                    }, 15000); 
                                    
                                    broadcastToAll(currentRoom, {
                                        type: 'timeReduced',
                                        remainingTime: 15
                                    });
                                }
                            } else {
                                
                                ws.send(JSON.stringify({
                                    type: 'wrongGuess',
                                    guess: guess
                                }));
                                
                                
                                broadcast(currentRoom, {
                                    type: 'playerGuessedWrong',
                                    playerId: playerInfo.id,
                                    playerName: playerInfo.name
                                }, ws);
                            }
                        }
                    }
                    break;
                
                case 'leaveRoom':
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (room) {
                            const playerInfo = room.players.get(ws);
                            room.players.delete(ws);
                            
                            if (room.players.size === 0) {
                                
                                clearTimeout(room.roundTimer);
                                clearTimeout(room.hintTimer);
                                rooms.delete(currentRoom);
                                console.log(`Room ${currentRoom} closed.`);
                            } else {
                                
                                const remainingPlayers = getPlayerList(currentRoom);
                                broadcast(currentRoom, { 
                                    type: 'playerLeft', 
                                    playerId: playerInfo.id,
                                    name: playerInfo.name,
                                    players: remainingPlayers 
                                }, null);
                                
                                
                                if (playerInfo.isHost) {
                                    const [newHostClient] = room.players.keys();
                                    const newHostInfo = room.players.get(newHostClient);
                                    newHostInfo.isHost = true;
                                    
                                    
                                    if (newHostClient.readyState === WebSocket.OPEN) {
                                        newHostClient.send(JSON.stringify({
                                            type: 'becameHost'
                                        }));
                                    }
                                    
                                    
                                    broadcast(currentRoom, {
                                        type: 'newHost',
                                        hostId: newHostInfo.id,
                                        hostName: newHostInfo.name
                                    }, newHostClient);
                                }
                                
                                
                                if (room.gameStarted && 
                                    room.currentEmojier === playerInfo.id &&
                                    (room.roundPhase === 'prep' || 
                                     room.roundPhase === 'emoji-selection')) {
                                    
                                    clearTimeout(room.roundTimer);
                                    clearTimeout(room.hintTimer);
                                    
                                    broadcastToAll(currentRoom, {
                                        type: 'emojierLeft',
                                        message: `${playerInfo.name} left the game.`
                                    });
                                    
                                    
                                    setTimeout(() => {
                                        startNewRound(currentRoom);
                                    }, 3000);
                                }
                                
                                console.log(`${playerInfo.name} left room ${currentRoom}.`);
                            }
                            ws.send(JSON.stringify({ type: 'leftRoom' }));
                        }
                        currentRoom = null;
                    }
                    break;

                case 'newRound':
                    
                    currentRoundDisplay.textContent = data.currentRound;
                    totalRoundsDisplay.textContent = data.totalRounds;
                    roundStatus.textContent = `Round ${data.currentRound} starting...`;
                    isEmojier = data.currentEmojier === playerId;
                    isStoryCreator = data.gameMode === 'story' && data.storyCreator === playerId;
                    showEmojierOrGuesserUI();
                    break;

                case 'promptAssigned':
                    
                    if (isEmojier || isStoryCreator) {
                        promptWord.textContent = data.prompt;
                    }
                    break;

                case 'selectEmoji':
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (!room) break;
                        
                        const playerInfo = room.players.get(ws);
                        
                        
                        
                        
                        const canSelectEmoji = (room.gameMode === GAME_MODES.STANDARD && playerInfo.id === room.currentEmojier) || 
                                              (room.gameMode === GAME_MODES.STORY && playerInfo.id === room.storyCreator);
                        
                        if (canSelectEmoji && room.roundPhase === 'emoji-selection') {
                            
                            if (room.selectedEmojis.length < MAX_EMOJI_COUNT) {
                                room.selectedEmojis.push(data.emoji);
                                
                                
                                if (room.gameMode === GAME_MODES.STORY && room.storyChain.length > 0) {
                                    const currentStoryItem = room.storyChain[room.storyChain.length - 1];
                                    currentStoryItem.emojis = [...room.selectedEmojis];
                                }
                                
                                
                                broadcastToAll(currentRoom, {
                                    type: 'emojiSelected',
                                    emoji: data.emoji,
                                    emojis: room.selectedEmojis,
                                    playerId: playerInfo.id
                                });
                            }
                        }
                    }
                    break;
                
                case 'lockEmojis':
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (!room) break;
                        
                        const playerInfo = room.players.get(ws);
                        
                        
                        const canLockEmojis = (room.gameMode === GAME_MODES.STANDARD && playerInfo.id === room.currentEmojier) || 
                                             (room.gameMode === GAME_MODES.STORY && playerInfo.id === room.storyCreator);
                        
                        if (canLockEmojis && room.roundPhase === 'emoji-selection' && 
                            room.selectedEmojis.length >= MIN_EMOJI_COUNT) {
                            
                            
                            if (room.gameMode === GAME_MODES.STORY && room.storyChain.length > 0) {
                                const currentStoryItem = room.storyChain[room.storyChain.length - 1];
                                currentStoryItem.emojis = [...room.selectedEmojis];
                            }
                            
                            
                            startGuessingPhase(currentRoom);
                        }
                    }
                    break;

                case 'submitStoryPrompt':
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (!room) break;
                        
                        const playerInfo = room.players.get(ws);
                        
                        if (room.gameMode === GAME_MODES.STORY && 
                            playerInfo.id === room.storyCreator && 
                            room.roundPhase === 'prep') {
                            
                            const prompt = data.prompt.trim();
                            if (prompt) {
                                createNewStoryPrompt(currentRoom, prompt);
                                startEmojiSelectionPhase(currentRoom);
                            }
                        }
                    }
                    break;

                case 'requestHint':
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (room && room.currentPrompt) {
                            
                            const hint = generateHint(room.currentPrompt, room.hintLevel || 0);
                            
                            
                            ws.send(JSON.stringify({
                                type: 'hintUpdate',
                                hint: hint
                            }));
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Failed to process message or invalid JSON:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const playerInfo = room.players.get(ws);
                room.players.delete(ws);
                
                if (playerInfo) {
                    if (room.players.size === 0) {
                        
                        clearTimeout(room.roundTimer);
                        clearTimeout(room.hintTimer);
                        rooms.delete(currentRoom);
                        console.log(`Room ${currentRoom} closed.`);
                    } else {
                        
                        broadcast(currentRoom, { 
                            type: 'playerLeft', 
                            playerId: playerInfo.id,
                            name: playerInfo.name,
                            players: getPlayerList(currentRoom) 
                        }, null);
                        
                        
                        if (playerInfo.isHost) {
                            const [newHostClient] = room.players.keys();
                            const newHostInfo = room.players.get(newHostClient);
                            newHostInfo.isHost = true;
                            
                            
                            if (newHostClient.readyState === WebSocket.OPEN) {
                                newHostClient.send(JSON.stringify({
                                    type: 'becameHost'
                                }));
                            }
                            
                            
                            broadcast(currentRoom, {
                                type: 'newHost',
                                hostId: newHostInfo.id,
                                hostName: newHostInfo.name
                            }, newHostClient);
                        }
                        
                        
                        if (room.gameStarted && 
                            room.currentEmojier === playerInfo.id &&
                            (room.roundPhase === 'prep' || 
                             room.roundPhase === 'emoji-selection')) {
                            
                            clearTimeout(room.roundTimer);
                            clearTimeout(room.hintTimer);
                            
                            broadcastToAll(currentRoom, {
                                type: 'emojierLeft',
                                message: `${playerInfo.name} left the game.`
                            });
                            
                            
                            setTimeout(() => {
                                startNewRound(currentRoom);
                            }, 3000);
                        }
                    }
                }
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const playerInfo = room.players.get(ws);
                room.players.delete(ws);
                
                if (room.players.size === 0) {
                    clearTimeout(room.roundTimer);
                    clearTimeout(room.hintTimer);
                    rooms.delete(currentRoom);
                } else if (playerInfo) {
                    broadcast(currentRoom, { 
                        type: 'playerLeft', 
                        playerId: playerInfo.id,
                        name: playerInfo.name,
                        players: getPlayerList(currentRoom) 
                    }, ws);
                }
            }
        }
    });
});

function generateHint(word, level) {
    
    
    const chars = word.split('');
    return chars.map((char, i) => {
        if (char === ' ') return ' ';
        return level > i ? char : '_';
    }).join(' ');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access the client at http://localhost:${PORT}`);
});